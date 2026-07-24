import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import * as path from 'path';
import * as fs from 'fs';

// ─── Existing interfaces (platform copilot chat) ────────────────────────────

export interface CopilotChatRequest {
    message: string;
    context: {
        page: string;
        tenantId?: string;
        tenantName?: string;
        userName: string;
        userRole: string;
        /** UI locale (es|en|pt|fr) — drives KB language and reply language. */
        locale?: string;
    };
    history: { role: string; content: string }[];
}

/** One functional help article of the assistant KB (kb/assistant/{locale}/*.md). */
interface KbArticle {
    id: string;
    locale: string;
    title: string;
    routes: string[];
    roles: string[];
    keywords: string[];
    body: string;
}

export interface CopilotChatResponse {
    reply: string;
    model?: string;
    tokensUsed?: number;
}

// ─── New interfaces (conversation copilot) ──────────────────────────────────

export interface SuggestedReply {
    text: string;
    tone: 'formal' | 'friendly' | 'empathetic';
}

export interface ConversationSummary {
    summary: string;
    customerIntent: string;
    keyInfoShared: string[];
    pendingQuestions: string[];
}

export interface IntentAnalysis {
    primaryIntent: string;
    confidence: number;
    recommendedAction: string;
}

export interface ContextualAnswer {
    answer: string;
    sources: string[];
}

const COPILOT_CACHE_TTL = 60; // seconds

@Injectable()
export class CopilotService {
    private readonly logger = new Logger(CopilotService.name);

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
        private redis: RedisService,
        private llmRouter: LLMRouterService,
        private knowledgeService: KnowledgeService,
    ) {}

    // ─── Assistant Knowledge Base (apps/api/kb/assistant/{locale}/*.md) ─────
    // The KB ships INSIDE the Docker image (Dockerfile.api copies apps/api/kb),
    // unlike the old docs/user-manual.md approach where docs/ was never in the
    // image and the assistant ran blind in production. Articles are functional
    // user-level ONLY — the KB itself is the primary guardrail: what isn't in
    // it, the assistant honestly says it doesn't know.

    private kbArticles = new Map<string, KbArticle[]>(); // locale → articles
    private kbLoadAttempted = new Set<string>();

    private static readonly KB_LOCALES = ['es', 'en', 'pt', 'fr'];
    private static readonly KB_STOPWORDS = new Set([
        'como', 'para', 'que', 'con', 'los', 'las', 'del', 'por', 'una', 'este', 'esta',
        'the', 'and', 'for', 'how', 'can', 'with', 'what', 'una', 'mais', 'pour', 'des',
        'quiero', 'puedo', 'hago', 'hacer', 'donde', 'cual', 'cuales', 'mis', 'sus',
    ]);

    /** Lowercase + strip diacritics so "configuración" matches "configuracion". */
    private normalize(s: string): string {
        // eslint-disable-next-line no-misleading-character-class
        return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    private kbBaseDirs(): string[] {
        return [
            path.join(process.cwd(), 'kb', 'assistant'),                    // prod image (/app/kb) + dev cwd=apps/api
            path.join(process.cwd(), 'apps', 'api', 'kb', 'assistant'),     // dev cwd=repo root
            path.resolve(__dirname, '../../../kb/assistant'),               // dist-relative fallback
            path.resolve(__dirname, '../../../../kb/assistant'),
        ];
    }

    /** Read one locale directory into a Map keyed by article id (no ES fallback). */
    private loadLocaleDir(loc: string): Map<string, KbArticle> {
        const byId = new Map<string, KbArticle>();
        let dir = '';
        for (const base of this.kbBaseDirs()) {
            try {
                if (fs.existsSync(path.join(base, loc))) { dir = path.join(base, loc); break; }
            } catch { /* keep trying */ }
        }
        if (!dir) return byId;

        try {
            for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
                try {
                    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
                    const parsed = this.parseKbArticle(raw, loc, file);
                    if (parsed) byId.set(parsed.id, parsed);
                } catch (e: any) {
                    this.logger.warn(`Skipping malformed KB article ${loc}/${file}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.error(`Failed reading assistant KB dir ${dir}: ${e.message}`);
        }
        return byId;
    }

    /**
     * Returns the full article set for a locale: native articles first, and any
     * article NOT yet translated is filled in from the Spanish base (100% topic
     * coverage even with partial translations — the LLM replies in the user's
     * language regardless of the article's source language). Spanish is the
     * canonical base and always loads its own directory.
     */
    private loadKb(locale: string): KbArticle[] {
        const loc = CopilotService.KB_LOCALES.includes(locale) ? locale : 'es';
        if (this.kbArticles.has(loc)) return this.kbArticles.get(loc)!;
        if (this.kbLoadAttempted.has(loc)) return this.kbArticles.get(loc) ?? [];
        this.kbLoadAttempted.add(loc);

        const merged = new Map<string, KbArticle>();
        // Spanish base first (canonical), then overlay native-locale articles.
        if (loc !== 'es') {
            for (const [id, a] of this.loadLocaleDir('es')) merged.set(id, a);
        }
        let native = 0;
        for (const [id, a] of this.loadLocaleDir(loc)) { merged.set(id, a); native++; }

        const articles = [...merged.values()];
        if (articles.length === 0) {
            this.logger.error(`Assistant KB empty for locale "${loc}" (tried ${this.kbBaseDirs().join(' | ')})`);
        } else {
            this.logger.log(`Assistant KB loaded for "${loc}": ${articles.length} articles (${native} native${loc !== 'es' ? `, ${articles.length - native} from es fallback` : ''})`);
        }
        this.kbArticles.set(loc, articles);
        return articles;
    }

    /** Front-matter: --- delimited; arrays as JSON (["a","b"]), scalars as plain text. */
    private parseKbArticle(raw: string, locale: string, file: string): KbArticle | null {
        const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (!m) return null;
        const meta: Record<string, any> = {};
        for (const line of m[1].split(/\r?\n/)) {
            const kv = line.match(/^(\w+):\s*(.*)$/);
            if (!kv) continue;
            const [, key, valRaw] = kv;
            const val = valRaw.trim();
            if (val.startsWith('[')) {
                try { meta[key] = JSON.parse(val); } catch { meta[key] = [val]; }
            } else {
                meta[key] = val.replace(/^"|"$/g, '');
            }
        }
        return {
            id: meta.id || file.replace(/\.md$/, ''),
            locale,
            title: meta.title || file,
            routes: Array.isArray(meta.routes) ? meta.routes : [],
            roles: Array.isArray(meta.roles) ? meta.roles : [],
            keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
            body: m[2].trim(),
        };
    }

    /** Top-N articles for the query, front-matter keywords weighted highest. */
    private searchKb(query: string, locale: string, topN = 3): KbArticle[] {
        const articles = this.loadKb(locale); // already merged with es fallback per-article
        if (articles.length === 0) return [];

        const words = this.normalize(query)
            .split(/[^a-z0-9]+/)
            .filter(w => w.length >= 2 && !CopilotService.KB_STOPWORDS.has(w));
        if (words.length === 0) return [];

        const scored = articles.map(a => {
            const nKeywords = a.keywords.map(k => this.normalize(k));
            const nTitle = this.normalize(a.title);
            const nBody = this.normalize(a.body);
            let score = 0;
            for (const w of words) {
                if (nKeywords.some(k => k === w)) score += 6;
                else if (nKeywords.some(k => k.includes(w) || w.includes(k))) score += 4;
                if (nTitle.includes(w)) score += 3;
                if (nBody.includes(w)) score += 1;
            }
            return { a, score };
        });

        return scored
            .filter(x => x.score > 0)
            .sort((x, y) => y.score - x.score)
            .slice(0, topN)
            .map(x => x.a);
    }

    // ─── Conversation Copilot Methods ───────────────────────────────────────

    /**
     * Returns 3 suggested replies based on conversation context.
     */
    async getSuggestions(tenantId: string, conversationId: string): Promise<SuggestedReply[]> {
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:suggestions:${conversationId}`);
        const cached = await this.redis.getJson<SuggestedReply[]>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return [{ text: 'No hay suficiente contexto para generar sugerencias.', tone: 'formal' }];
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un copiloto de ventas que asiste a agentes humanos de atención al cliente en Latinoamérica.
Basándote en el historial de la conversación, genera exactamente 3 respuestas sugeridas que el agente podría enviar al cliente.

Cada sugerencia debe ser:
- Corta (máximo 2 oraciones)
- Profesional y cálida
- En español latinoamericano
- Relevante al último mensaje del cliente

Responde ÚNICAMENTE con un JSON array con este formato:
[
  { "text": "respuesta 1", "tone": "formal" },
  { "text": "respuesta 2", "tone": "friendly" },
  { "text": "respuesta 3", "tone": "empathetic" }
]

No incluyas explicaciones, solo el JSON.`,
                temperature: 0.7,
                maxTokens: 500,
                tenantId,
            });

            const suggestions = this.parseJsonSafe<SuggestedReply[]>(response.content, [
                { text: 'Gracias por contactarnos. Permítame revisar su caso.', tone: 'formal' },
                { text: '¡Claro! Con gusto le ayudo con eso.', tone: 'friendly' },
                { text: 'Entiendo su situación. Vamos a resolverlo juntos.', tone: 'empathetic' },
            ]);

            await this.redis.setJson(cacheKey, suggestions, COPILOT_CACHE_TTL);
            return suggestions;
        } catch (error: any) {
            this.logger.error(`getSuggestions failed: ${error.message}`);
            return [
                { text: 'Gracias por contactarnos. Permítame revisar su caso.', tone: 'formal' },
                { text: '¡Claro! Con gusto le ayudo con eso.', tone: 'friendly' },
                { text: 'Entiendo su situación. Vamos a resolverlo juntos.', tone: 'empathetic' },
            ];
        }
    }

    /**
     * Returns a concise summary of the conversation so far.
     */
    async getSummary(tenantId: string, conversationId: string): Promise<ConversationSummary> {
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:summary:${conversationId}`);
        const cached = await this.redis.getJson<ConversationSummary>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return {
                summary: 'No hay mensajes en esta conversación.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            };
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un copiloto de ventas que analiza conversaciones para agentes humanos.
Analiza el historial de la conversación y genera un resumen conciso.

Responde ÚNICAMENTE con un JSON con este formato:
{
  "summary": "Resumen breve de la conversación en 1-2 oraciones",
  "customerIntent": "Qué busca o necesita el cliente",
  "keyInfoShared": ["dato clave 1", "dato clave 2"],
  "pendingQuestions": ["pregunta sin resolver 1", "pregunta sin resolver 2"]
}

Usa español latinoamericano. No incluyas explicaciones, solo el JSON.`,
                temperature: 0.3,
                maxTokens: 500,
                tenantId,
            });

            const summary = this.parseJsonSafe<ConversationSummary>(response.content, {
                summary: 'No se pudo generar el resumen.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            });

            await this.redis.setJson(cacheKey, summary, COPILOT_CACHE_TTL);
            return summary;
        } catch (error: any) {
            this.logger.error(`getSummary failed: ${error.message}`);
            return {
                summary: 'Error al generar el resumen.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            };
        }
    }

    /**
     * Analyzes the last few messages and returns intent analysis.
     */
    async detectIntent(tenantId: string, conversationId: string): Promise<IntentAnalysis> {
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:intent:${conversationId}`);
        const cached = await this.redis.getJson<IntentAnalysis>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'Esperar más contexto del cliente.',
            };
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un analizador de intención de clientes para un equipo de ventas en Latinoamérica.
Analiza los últimos mensajes de la conversación y determina la intención del cliente.

Intenciones posibles:
- "product_inquiry" — Pregunta sobre productos o servicios
- "complaint" — Queja o reclamo
- "purchase_intent" — Intención de compra
- "support" — Solicitud de soporte técnico
- "pricing" — Consulta de precios
- "scheduling" — Agendar cita o reunión
- "follow_up" — Seguimiento de caso anterior
- "general_info" — Información general

Responde ÚNICAMENTE con un JSON con este formato:
{
  "primaryIntent": "una_de_las_intenciones_anteriores",
  "confidence": 0.85,
  "recommendedAction": "Acción recomendada para el agente en español"
}

El campo confidence debe ser un número entre 0 y 1. No incluyas explicaciones, solo el JSON.`,
                temperature: 0.2,
                maxTokens: 300,
                tenantId,
            });

            const intent = this.parseJsonSafe<IntentAnalysis>(response.content, {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'No se pudo determinar la intención.',
            });

            // Clamp confidence to 0-1
            intent.confidence = Math.max(0, Math.min(1, intent.confidence));

            await this.redis.setJson(cacheKey, intent, COPILOT_CACHE_TTL);
            return intent;
        } catch (error: any) {
            this.logger.error(`detectIntent failed: ${error.message}`);
            return {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'Error al analizar la intención.',
            };
        }
    }

    /**
     * Agent asks a question about the conversation/product. Uses RAG knowledge base + conversation context.
     */
    async getContextualHelp(
        tenantId: string,
        conversationId: string,
        agentQuery: string,
    ): Promise<ContextualAnswer> {
        const messages = await this.loadRecentMessages(tenantId, conversationId);
        const conversationContext = messages
            ? messages.map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.content_text}`).join('\n')
            : '(Sin contexto de conversación)';

        // Search knowledge base for relevant info
        let knowledgeContext = '';
        const sources: string[] = [];
        try {
            const results = await this.knowledgeService.searchRelevant(tenantId, agentQuery, 3);
            if (results && results.length > 0) {
                knowledgeContext = results
                    .map((r: any) => r.chunk_text)
                    .join('\n---\n');
                sources.push(
                    ...results.map((r: any) => r.document_title).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i),
                );
            }
        } catch (error: any) {
            this.logger.warn(`Knowledge search failed: ${error.message}`);
        }

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: agentQuery }],
                tenantId,
                systemPrompt: `Eres un copiloto inteligente que ayuda a agentes de ventas y soporte en Latinoamérica.
El agente te hace una pregunta mientras atiende a un cliente. Responde de forma útil y concisa.

## Contexto de la conversación actual:
${conversationContext}

${knowledgeContext ? `## Información de la base de conocimiento:\n${knowledgeContext}` : '## No hay información relevante en la base de conocimiento.'}

Reglas:
- Responde en español latinoamericano
- Sé conciso y directo (máximo 3-4 oraciones)
- Si no tienes suficiente información, indícalo honestamente
- Prioriza la información de la base de conocimiento cuando esté disponible`,
                temperature: 0.4,
                maxTokens: 500,
            });

            return {
                answer: response.content || 'No pude generar una respuesta.',
                sources,
            };
        } catch (error: any) {
            this.logger.error(`getContextualHelp failed: ${error.message}`);
            return {
                answer: 'Error al procesar tu consulta. Intenta reformularla.',
                sources: [],
            };
        }
    }

    /**
     * Rewrites an agent's draft reply in a given tone, preserving meaning and language.
     * Tones: professional | friendly | empathetic | shorter | expand | fix_grammar
     */
    async rewriteReply(
        tenantId: string,
        draft: string,
        tone: string,
        conversationId?: string,
    ): Promise<{ text: string }> {
        if (!draft || !draft.trim()) {
            return { text: '' };
        }

        const toneInstructions: Record<string, string> = {
            professional: 'Reescribe el texto en un tono profesional y cortés.',
            friendly: 'Reescribe el texto en un tono cálido, cercano y amigable.',
            empathetic: 'Reescribe el texto mostrando empatía y comprensión hacia el cliente.',
            shorter: 'Haz el texto más corto y directo, conservando el mensaje esencial.',
            expand: 'Expande ligeramente el texto con un poco más de detalle y cordialidad, sin volverlo largo.',
            fix_grammar: 'Corrige ortografía, gramática y puntuación sin cambiar el significado ni el tono.',
        };
        const instruction = toneInstructions[tone] || toneInstructions['professional'];

        // Optional conversation context (only to inform tone, never to invent content).
        let contextBlock = '';
        if (conversationId) {
            try {
                const messages = await this.loadRecentMessages(tenantId, conversationId);
                if (messages && messages.length) {
                    const ctx = messages
                        .slice(-6)
                        .map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.content_text}`)
                        .join('\n');
                    contextBlock = `\n\n## Contexto reciente (solo referencia, no copiar):\n${ctx}`;
                }
            } catch {
                // best-effort; context is optional
            }
        }

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: draft }],
                systemPrompt: `Eres un asistente de redacción para agentes de atención al cliente y ventas.
${instruction}

Reglas estrictas:
- Mantén EXACTAMENTE el mismo idioma del texto original.
- Conserva el significado y la intención del mensaje.
- No inventes datos, precios, fechas ni compromisos que no estén en el texto original.
- Devuelve ÚNICAMENTE el texto reescrito: sin comillas, sin explicaciones, sin prefijos.${contextBlock}`,
                temperature: 0.4,
                maxTokens: 400,
                tenantId,
            });

            const text = (response.content || '').trim();
            return { text: text || draft };
        } catch (error: any) {
            this.logger.error(`rewriteReply failed: ${error.message}`);
            return { text: draft };
        }
    }

    /**
     * Invalidate all copilot caches for a conversation (call on new message).
     */
    async invalidateCache(tenantId: string, conversationId: string): Promise<void> {
        const keys = [
            this.redis.tenantKey(tenantId, `copilot:suggestions:${conversationId}`),
            this.redis.tenantKey(tenantId, `copilot:summary:${conversationId}`),
            this.redis.tenantKey(tenantId, `copilot:intent:${conversationId}`),
        ];
        for (const key of keys) {
            await this.redis.del(key);
        }
    }

    // ─── Platform Copilot Chat (existing) ───────────────────────────────────

    async chat(request: CopilotChatRequest): Promise<CopilotChatResponse> {
        const tenantId = request.context.tenantId;
        const locale = (request.context.locale || 'es').slice(0, 2).toLowerCase();
        const articles = this.searchKb(request.message, locale);

        // Each retrieved article is injected with its navigation metadata so the
        // assistant can give exact menu paths and role requirements.
        const kbContext = articles.length > 0
            ? articles.map(a => {
                const roles = a.roles.length ? ` | Requiere rol: ${a.roles.join(' o ')}` : '';
                const routes = a.routes.length ? ` | Ruta en el panel: ${a.routes.join(' , ')}` : '';
                return `### Artículo: ${a.title}${routes}${roles}\n${a.body}`;
            }).join('\n\n---\n\n')
            : '(No se encontró información relevante en la base de conocimiento para esta consulta.)';

        const langNames: Record<string, string> = { es: 'español latinoamericano', en: 'English', pt: 'português brasileiro', fr: 'français' };
        const replyLang = langNames[locale] || langNames.es;

        const systemPrompt = `Eres **Parallly Assist**, el asistente oficial de ayuda de la plataforma Parallly.
Tu única misión: ayudar a los usuarios (administradores, supervisores y agentes de negocio) a entender, configurar y usar las funcionalidades de la plataforma.

## BASE DE CONOCIMIENTO (única fuente de verdad sobre la plataforma):
${kbContext}

## REGLAS CRÍTICAS:
1. **RESPONDE SOLO DESDE LA BASE DE CONOCIMIENTO.** Toda afirmación sobre la plataforma (menús, funciones, límites, precios, pasos) debe salir de los artículos de arriba. Si la información no está ahí, dilo con honestidad: "No tengo esa información con certeza" y sugiere escribir a soporte (https://parallly-chat.cloud/support). NUNCA inventes menús, funciones, precios ni límites.
2. **SOLO NIVEL FUNCIONAL.** Explicas cómo usar la plataforma: pantallas, menús, campos, configuraciones y flujos. NUNCA hables de tecnologías, código, bases de datos, servidores, infraestructura ni de cómo está construida la plataforma. Si te lo preguntan, responde exactamente con la idea: "Soy el asistente de ayuda de Parallly y te acompaño en el uso de la plataforma. Sobre temas técnicos internos no tengo información. ¿Te ayudo con alguna configuración o funcionalidad?" (adaptada al idioma del usuario).
3. **IDIOMA:** responde SIEMPRE en ${replyLang}, con tono cálido, servicial y profesional. Aunque el artículo esté en otro idioma, tu respuesta va en ${replyLang}.
4. **NAVEGACIÓN EXACTA:** cuando guíes al usuario, usa las rutas de menú tal como aparecen en los artículos (sección y nombre del ítem). Formato paso a paso con listas numeradas.
5. **ROLES:** si la acción requiere un rol que el usuario no tiene (ver "Requiere rol" del artículo y el rol del usuario abajo), acláralo amablemente ("esto lo configura un administrador de la cuenta").
6. **FORMATO:** Markdown limpio: pasos numerados, viñetas, **negritas** para nombres de menús y botones. Respuestas concisas; máximo ~10 líneas salvo que pidan detalle.

## Contexto de la consulta:
- Usuario: ${request.context.userName} (rol: ${request.context.userRole})
- Página actual del panel: ${request.context.page}`;

        const messages = [
            ...request.history.slice(-10).map(m => ({
                role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content
            })),
            { role: 'user' as const, content: request.message }
        ];

        try {
            const response = await this.llmRouter.execute({
                task: 'conversation',
                messages,
                systemPrompt,
                tenantId,
                // Low temperature: this is a support assistant — accuracy over creativity.
                temperature: 0.4,
                maxTokens: 800,
            });

            this.logger.log(
                `Copilot reply for user "${request.context.userName}" on ${request.context.page} ` +
                `via ${response.routingDecision?.selectedModel?.id || 'default'}`
            );

            return {
                reply: response.content || this.getFallbackResponse(locale),
                model: response.routingDecision?.selectedModel?.id,
                tokensUsed: response.usage?.totalTokens,
            };
        } catch (error: any) {
            this.logger.error('Copilot chat error, returning fallback:', error);
            return {
                reply: this.getFallbackResponse(locale)
            };
        }
    }

    // ─── Private Helpers ────────────────────────────────────────────────────

    private async loadRecentMessages(tenantId: string, conversationId: string): Promise<any[] | null> {
        const schemaName = await this.tenantSchema(tenantId);

        try {
            const messages = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, content_text, content_type, direction, created_at, metadata
                 FROM messages
                 WHERE conversation_id = $1::uuid
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [conversationId],
            );
            return messages && messages.length > 0 ? messages.reverse() : null;
        } catch (error: any) {
            this.logger.error(`Failed to load messages for ${conversationId}: ${error.message}`);
            return null;
        }
    }

    private buildChatMessages(messages: any[]): { role: 'user' | 'assistant'; content: string }[] {
        return messages
            .filter((m: any) => m.content_text)
            .map((m: any) => ({
                role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content_text,
            }));
    }

    private parseJsonSafe<T>(raw: string, fallback: T): T {
        try {
            // Try to extract JSON from the response (handles markdown code blocks)
            const jsonMatch = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as T;
            }
            return JSON.parse(raw) as T;
        } catch {
            this.logger.warn(`Failed to parse LLM JSON response, using fallback`);
            return fallback;
        }
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ─── Fallback (platform copilot) ────────────────────────────────────────
    // Honest, localized fallback for when the LLM is unavailable. Never invents
    // platform facts (the previous version described a long-gone product era).

    private getFallbackResponse(locale: string): string {
        const fallbacks: Record<string, string> = {
            es: 'En este momento no puedo responder tu consulta por un problema temporal del asistente. Intenta de nuevo en unos minutos o escríbenos en https://parallly-chat.cloud/support — con gusto te ayudamos.',
            en: 'I can\'t answer your question right now due to a temporary issue with the assistant. Please try again in a few minutes or reach us at https://parallly-chat.cloud/support — we\'ll be happy to help.',
            pt: 'No momento não consigo responder à sua pergunta por um problema temporário do assistente. Tente novamente em alguns minutos ou fale conosco em https://parallly-chat.cloud/support — teremos prazer em ajudar.',
            fr: 'Je ne peux pas répondre à votre question pour le moment en raison d\'un problème temporaire de l\'assistant. Réessayez dans quelques minutes ou contactez-nous sur https://parallly-chat.cloud/support — nous serons ravis de vous aider.',
        };
        return fallbacks[locale] || fallbacks.es;
    }
}
