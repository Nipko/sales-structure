import { Injectable, Logger, Optional } from '@nestjs/common';
import type { VerticalRecipeExtras } from '@parallext/shared';
import { PURCHASE_MODES, RECIPE_BLANKS, RECIPE_FAMILIES, RECIPE_SHAPE } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { getVerticalDefinition } from './vertical-definitions';

import { formatRecipeLint, lintRecipes, RECIPE_CHANNELS } from './recipe-lint';

/**
 * D9 (sep-2026) — la receta de un negocio que no encaja en las 18 industrias.
 *
 * "Otro" era la hoja en blanco. Un tenant que lo elegía nacía con cero
 * servicios, cinco FAQ genéricas que no dicen nada y una agente llamada Andrea
 * cuyo saludo no menciona el negocio. En la grabación del 14-sep esa fue la
 * pantalla donde la dueña se quedó: no hay nada que confirmar, así que no hay
 * nada que hacer más que escribirlo todo.
 *
 * Acá el modelo escribe esa receta a partir de la frase que la persona ya puso
 * en el alta ("qué hace tu negocio"), con TRES candados:
 *
 * 1. El esquema que se le pide **no tiene** precio, dirección ni teléfono. No
 *    puede inventar lo que no se le pregunta.
 * 2. Lo que devuelve pasa por el MISMO lint que las recetas escritas a mano
 *    (`lintRecipes`). Un solo error y se descarta ENTERA — media receta con un
 *    precio inventado es peor que ninguna, y ese es el criterio que el resto
 *    del código ya usa para la salida del modelo.
 * 3. Nunca reemplaza nada que el dueño haya tocado: se guarda aparte y el día 0
 *    la usa como sugerencia.
 *
 * Si algo falla —el modelo, el presupuesto, el lint— no pasa nada: el tenant se
 * queda con la receta genérica que ya tenía. Esta función no puede romper un
 * alta.
 */

/**
 * Las frases exactas con las que el motor de "Otro" pasa a una persona.
 *
 * El modelo tiene que elegir entre ESTAS, no inventar una: un motivo con un
 * disparador que no existe es una ficha que el runtime nunca va a cumplir.
 */
function otroHandoffTriggers(): string {
    return (getVerticalDefinition('otro').agent.handoffTriggers?.es ?? '')
        .split('|').map((t) => t.trim()).filter(Boolean).join(' | ');
}

/** Dónde vive la receta generada, dentro de `tenants.settings`. */
export const GENERATED_RECIPE_SETTINGS_KEY = 'generatedRecipe';

/** Un intento por tenant a la vez. */
const GENERATION_LOCK_TTL_SECONDS = 600;

/**
 * Cuánto se espera antes de reintentar después de un intento fallido.
 *
 * El candado se suelta al terminar, así que sin esto un modelo que devuelve
 * algo que el lint rechaza producía una llamada pagada en CADA carga de la
 * pantalla. El comentario decía "no más de uno cada diez minutos" y no había
 * nada que lo hiciera cierto.
 */
const GENERATION_COOLDOWN_SECONDS = 900;

/**
 * Lo mínimo que tiene que traer una receta generada para llamarse receta.
 *
 * El lint reporta lo que falta como `gap` para no romper la suite por las
 * industrias sin escribir; una receta que el modelo acaba de escribir no tiene
 * esa excusa.
 */
const REQUIRED_GENERATED_FIELDS = [
    'mainInstructions', 'whenUnsure', 'handoffReasons', 'canonicalQuestions',
] as const;

export interface GeneratedRecipeRecord {
    /** La receta que pasó el lint. */
    recipe: VerticalRecipeExtras;
    /** La frase de la que salió, para poder regenerar si el dueño la cambia. */
    sourceHash: string;
    generatedAt: string;
    model?: string;
}

@Injectable()
export class OtroRecipeService {
    private readonly logger = new Logger(OtroRecipeService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        @Optional() private readonly llm?: LLMRouterService,
    ) {}

    /**
     * La receta guardada para este tenant, si ya se generó y sigue
     * correspondiendo a la descripción actual del negocio.
     */
    async read(tenantId: string): Promise<GeneratedRecipeRecord | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const stored = (tenant?.settings as any)?.[GENERATED_RECIPE_SETTINGS_KEY];
        if (!stored?.recipe) return null;
        return stored as GeneratedRecipeRecord;
    }

    /**
     * Arranca una generación sin esperarla.
     *
     * El día 0 no puede quedarse mirando una pantalla en blanco mientras un
     * modelo escribe: la pantalla muestra la receta genérica de inmediato y la
     * generada aparece en la siguiente lectura. Si el proceso se reinicia en el
     * medio, la próxima lectura lo vuelve a intentar — el candado se suelta solo.
     */
    kickOff(tenantId: string, locale: string): void {
        void this.generate(tenantId, locale).catch((error: any) => {
            this.logger.warn(`Otro recipe generation failed for ${tenantId}: ${error?.message}`);
        });
    }

    /**
     * Genera, valida y guarda. Devuelve la receta o `null` si no se pudo.
     *
     * Nunca lanza hacia afuera por un fallo del modelo: un negocio sin receta
     * generada sigue siendo un negocio que funciona.
     */
    async generate(tenantId: string, locale = 'es'): Promise<GeneratedRecipeRecord | null> {
        if (!this.llm) return null;

        const description = await this.readBusinessDescription(tenantId);
        if (!description || description.trim().length < 20) {
            // Menos de veinte caracteres no describe un negocio: generar sobre
            // "tienda" produce exactamente la receta genérica, con el costo de
            // dos llamadas al modelo.
            return null;
        }

        const sourceHash = this.hash(description);
        const existing = await this.read(tenantId);
        if (existing?.sourceHash === sourceHash) return existing;

        // Guion bajo, nunca dos puntos: BullMQ los rechaza y las claves de este
        // repo ya siguen esa convención.
        const cooldownKey = `otro-recipe:cooldown:${tenantId}`;
        if (await this.redis.get(cooldownKey)) return existing;

        const lockKey = `lock:otro-recipe:${tenantId}`;
        const token = await this.redis.acquireLockToken(lockKey, GENERATION_LOCK_TTL_SECONDS);
        if (!token) return existing;
        // Se marca ANTES de llamar al modelo. Si el proceso muere en el medio,
        // el siguiente intento espera el enfriamiento en vez de repetir una
        // llamada que quizá ya se cobró.
        await this.redis.set(cooldownKey, '1', GENERATION_COOLDOWN_SECONDS).catch(() => undefined);

        try {
            const raw = await this.ask(tenantId, description, locale);
            if (!raw) return existing;

            const parsed = this.parseJson(raw.content);
            if (!parsed) {
                this.logger.warn(`Otro recipe for ${tenantId}: the model did not return JSON`);
                return existing;
            }

            const recipe = this.coerce(parsed);
            if (!recipe) return existing;

            // El lint trata lo que FALTA como `gap`, no como error, porque una
            // industria sin escribir no puede romper la suite. Para una receta
            // generada ese criterio se invierte: un modelo que devuelve
            // `{"family":"booking"}` pasaba las tres compuertas y se guardaba
            // como la receta del negocio. Lo mínimo para llamarse receta se
            // exige acá, antes del lint.
            const missing = REQUIRED_GENERATED_FIELDS.filter((field) => {
                const value = (recipe as Record<string, unknown>)[field];
                return !value || (Array.isArray(value) && value.length === 0);
            });
            if (missing.length) {
                this.logger.warn(`Otro recipe for ${tenantId} came back without ${missing.join(', ')}`);
                return existing;
            }

            const rejection = this.lint(recipe);
            if (rejection) {
                // Se descarta entera, a propósito. Aceptar "la parte buena" de
                // una receta que inventó un precio deja el precio adentro.
                this.logger.warn(`Otro recipe for ${tenantId} rejected by the lint:\n${rejection}`);
                return existing;
            }

            const record: GeneratedRecipeRecord = {
                recipe,
                sourceHash,
                generatedAt: new Date().toISOString(),
                model: raw.model,
            };
            await this.store(tenantId, record);
            this.logger.log(`Otro recipe generated for tenant ${tenantId}`);
            return record;
        } finally {
            await this.redis.releaseLockToken(lockKey, token).catch(() => undefined);
        }
    }

    // ── el modelo ──────────────────────────────────────────────────────────

    private async ask(
        tenantId: string,
        description: string,
        locale: string,
    ): Promise<{ content: string; model?: string } | null> {
        try {
            const response = await this.llm!.execute({
                task: 'conversation',
                // Con techo explícito: sin `allowedTiers` el router habilita los
                // cuatro niveles, y una cuenta de plan básico terminaría
                // escribiendo su receta en el modelo más caro del catálogo.
                allowedTiers: ['tier_2_standard', 'tier_3_efficient'],
                // Con tenantId: si no, la llamada no reserva presupuesto, no
                // suma a `llm:cost:*` y no aparece en ningún tablero. Una
                // generación invisible es una que nadie puede apagar.
                tenantId,
                temperature: 0.4,
                maxTokens: 3500,
                jsonMode: true,
                systemPrompt: this.systemPrompt(locale, otroHandoffTriggers()),
                messages: [{ role: 'user', content: description.slice(0, 2000) }],
            });
            return { content: response?.content || '', model: (response as any)?.model };
        } catch (error: any) {
            // Un 429 de presupuesto no es un proveedor caído: el router lo
            // relanza en vez de pasar al siguiente modelo, y reintentarlo solo
            // gasta la cuota que ya se acabó.
            this.logger.warn(`Otro recipe model call failed for ${tenantId}: ${error?.message}`);
            return null;
        }
    }

    private systemPrompt(locale: string, triggers: string): string {
        const blanks = RECIPE_BLANKS.map((b) => `[${b}]`).join(' · ');
        return [
            'Escribes la configuración inicial del asistente de un negocio pequeño, a partir de una frase que su dueño escribió sobre lo que hace.',
            '',
            'LO QUE NO SABES Y NO PUEDES INVENTAR: la dirección, el teléfono, el correo, los precios, los medios de pago, las zonas de entrega, los horarios, las condiciones de cambio o cancelación, ni ningún otro dato del negocio.',
            'Donde iría uno de esos datos, escribe un espacio en blanco con nombre, exactamente de esta lista:',
            blanks,
            'Un espacio vacío lo llena el dueño tocándolo. Un dato inventado que suena bien se publica y le miente a un cliente real.',
            '',
            'Devuelve SOLO un objeto JSON, sin texto alrededor y sin bloques de código, con esta forma:',
            '{',
            `  "family": uno de ${RECIPE_FAMILIES.join(' | ')},`,
            `  "purchaseModes": lista de 1 a 3 de ${PURCHASE_MODES.join(' | ')},`,
            '  "mainInstructions": {"es","en","pt","fr"} — dos o tres frases en segunda persona describiendo el trabajo del asistente,',
            `  "whenUnsure": ${RECIPE_SHAPE.whenUnsure} textos {"es","en","pt","fr"} — qué dice cuando no sabe algo,`,
            `  "handoffReasons": de ${RECIPE_SHAPE.handoffReasonsMin} a ${RECIPE_SHAPE.handoffReasonsMax} objetos {"text": {"es","en","pt","fr"}, "trigger": "..."} — por qué pasa la conversación a una persona, en palabras del dueño, y con cuál de estas frases exactas se cumple: ${triggers},`,
            `  "canonicalQuestions": exactamente ${RECIPE_SHAPE.canonicalQuestions} objetos {"question": {...}, "answer": {...}} — las preguntas que este negocio recibe todos los días, con su respuesta y sus espacios en blanco,`,
            `  "recommendedChannels": de 1 a ${RECIPE_SHAPE.recommendedChannelsMax} objetos {"channel": uno de ${RECIPE_CHANNELS.join(' | ')}, "why": {...}} — por dónde le conviene empezar y por qué,`,
            `  "testQuestions": ${RECIPE_SHAPE.testQuestions} textos {"es","en","pt","fr"} — lo que el dueño le puede preguntar al asistente para ver si sirve,`,
            `  "conversationExamples": ${RECIPE_SHAPE.conversationExamples} objetos {"customer": {...}, "agent": {...}} — un ida y vuelta real de ese rubro`,
            '}',
            '',
            'Cada texto lleva los cuatro idiomas: es, en, pt, fr. Ninguno puede quedar vacío. El español es el original; los otros tres son su traducción.',
            'No uses las palabras: devolución, descuento, abogado, emergencia, reembolso — el motor las usa para pasar la conversación a una persona y una pregunta que las contenga nunca llega a contestarse.',
            'No uses jerga de software: borrador, publicar, candidato, webhook, token, prospecto.',
            `El idioma principal del negocio es ${locale}.`,
        ].join('\n');
    }

    /**
     * El modo JSON de Anthropic es una frase en el prompt, no una restricción
     * de decodificación, y la cadena de respaldo puede mandar esta llamada allá.
     * Así que el texto puede venir con cercas o con prosa alrededor.
     */
    private parseJson(raw: string): Record<string, unknown> | null {
        if (!raw) return null;
        const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
        const match = withoutFences.match(/\{[\s\S]*\}/);
        try {
            const parsed = JSON.parse(match ? match[0] : withoutFences);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    // ── validación ─────────────────────────────────────────────────────────

    /**
     * Toma sólo los campos del contrato y descarta todo lo demás.
     *
     * Un campo extra que el modelo se inventó no se guarda: el esquema es lo
     * que el panel sabe pintar, y guardar lo que no sabe pintar es guardar algo
     * que nadie va a mirar nunca.
     */
    private coerce(parsed: Record<string, unknown>): VerticalRecipeExtras | null {
        const localized = (v: unknown) => {
            if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
            const record = v as Record<string, unknown>;
            const out: Record<string, string> = {};
            for (const locale of ['es', 'en', 'pt', 'fr']) {
                const value = record[locale];
                if (typeof value !== 'string' || !value.trim()) return null;
                out[locale] = value.trim();
            }
            return out;
        };
        const localizedList = (v: unknown) => {
            if (!Array.isArray(v)) return undefined;
            const out = v.map(localized);
            return out.some((entry) => entry === null) ? null : (out as Record<string, string>[]);
        };

        const recipe: VerticalRecipeExtras = {};

        if (typeof parsed.family === 'string' && (RECIPE_FAMILIES as readonly string[]).includes(parsed.family)) {
            recipe.family = parsed.family as VerticalRecipeExtras['family'];
        }
        if (Array.isArray(parsed.purchaseModes)) {
            const modes = parsed.purchaseModes.filter(
                (m): m is string => typeof m === 'string' && (PURCHASE_MODES as readonly string[]).includes(m),
            );
            if (modes.length) recipe.purchaseModes = modes as VerticalRecipeExtras['purchaseModes'];
        }

        const instructions = localized(parsed.mainInstructions);
        if (instructions) recipe.mainInstructions = instructions;

        for (const field of ['whenUnsure', 'testQuestions'] as const) {
            const list = localizedList(parsed[field]);
            if (list === null) return null;
            if (list) recipe[field] = list;
        }

        // Un motivo visible SIN el disparador que lo cumple es una ficha que el
        // motor no honra. El lint lo rechaza igual; acá se descarta antes para
        // que el error diga qué faltó.
        if (Array.isArray(parsed.handoffReasons)) {
            const reasons = parsed.handoffReasons.map((entry: any) => {
                const text = localized(entry?.text);
                const trigger = typeof entry?.trigger === 'string' ? entry.trigger.trim() : '';
                return text && trigger ? { text, trigger } : null;
            });
            if (reasons.some((r) => r === null)) return null;
            recipe.handoffReasons = reasons as NonNullable<VerticalRecipeExtras['handoffReasons']>;
        }

        if (Array.isArray(parsed.canonicalQuestions)) {
            const questions = parsed.canonicalQuestions.map((entry: any) => {
                const question = localized(entry?.question);
                const answer = localized(entry?.answer);
                return question && answer ? { question, answer } : null;
            });
            if (questions.some((q) => q === null)) return null;
            recipe.canonicalQuestions = questions as NonNullable<VerticalRecipeExtras['canonicalQuestions']>;
        }

        if (Array.isArray(parsed.recommendedChannels)) {
            const channels = parsed.recommendedChannels.map((entry: any) => {
                const why = localized(entry?.why);
                const channel = typeof entry?.channel === 'string' ? entry.channel : null;
                return why && channel ? { channel, why } : null;
            });
            if (channels.some((c) => c === null)) return null;
            recipe.recommendedChannels = channels as NonNullable<VerticalRecipeExtras['recommendedChannels']>;
        }

        if (Array.isArray(parsed.conversationExamples)) {
            const examples = parsed.conversationExamples.map((entry: any) => {
                const customer = localized(entry?.customer);
                const agent = localized(entry?.agent);
                return customer && agent ? { customer, agent } : null;
            });
            if (examples.some((e) => e === null)) return null;
            recipe.conversationExamples = examples as NonNullable<VerticalRecipeExtras['conversationExamples']>;
        }

        return Object.keys(recipe).length ? recipe : null;
    }

    /** El mismo lint que las recetas escritas a mano. Devuelve el motivo, o null. */
    private lint(recipe: VerticalRecipeExtras): string | null {
        const base = getVerticalDefinition('otro');
        const candidate = { ...base, recipe };
        const report = lintRecipes({
            registry: { otro: candidate } as any,
            resolve: () => candidate,
        });
        return report.errors.length ? formatRecipeLint(report.errors) : null;
    }

    // ── lectura y escritura ────────────────────────────────────────────────

    private async readBusinessDescription(tenantId: string): Promise<string | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true, settings: true },
        });
        if (!tenant) return null;

        // La descripción vive en la ficha del negocio; el borrador del alta es
        // el respaldo para las cuentas cuya ficha todavía no se escribió.
        try {
            const rows = await this.prisma.executeInTenantSchema<Array<{ about: string | null }>>(
                tenant.schemaName,
                `SELECT about FROM companies WHERE is_primary = true ORDER BY created_at LIMIT 1`,
            );
            const about = rows?.[0]?.about;
            if (about && about.trim()) return about;
        } catch {
            // Una ficha que todavía no existe no es un error acá.
        }

        const draft = (tenant.settings as any)?.businessInfoDraft?.about;
        return typeof draft === 'string' && draft.trim() ? draft : null;
    }

    private async store(tenantId: string, record: GeneratedRecipeRecord): Promise<void> {
        await this.prisma.$executeRawUnsafe(
            `UPDATE public.tenants
                SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb
              WHERE id = $1::uuid`,
            tenantId,
            JSON.stringify({ [GENERATED_RECIPE_SETTINGS_KEY]: record }),
        );
    }

    private hash(value: string): string {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('crypto').createHash('sha256').update(value.trim()).digest('hex').slice(0, 32);
    }
}
