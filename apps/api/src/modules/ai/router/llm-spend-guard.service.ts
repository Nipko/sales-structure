import { Injectable, Logger, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CronLockService } from '../../redis/cron-lock.service';
import type { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';

export class LlmBudgetUnavailable extends ServiceUnavailableException {
    constructor() { super({ error: 'llm_budget_unavailable' }); }
}
export class LlmBudgetExceeded extends HttpException {
    constructor() { super({ error: 'llm_budget_exceeded' }, 429); }
}
export type ModelPrice = { id: string; costInPer1k: number; costOutPer1k: number; maxContextTokens: number };

/**
 * Marca de una llamada que salió sin poder medirse. No hay fila que conciliar,
 * así que todo lo que recibe este identificador no hace nada — y se ve distinto
 * de una reserva real en cualquier log.
 */
const UNMETERED_PREFIX = 'unmetered:';
export const isUnmeteredReservation = (id: string): boolean => id.startsWith(UNMETERED_PREFIX);

/** Micro-USD, rounded upwards. The catalogue is an estimate, not a provider invoice. */
export function modelCostMicro(price: ModelPrice, input: number, output: number): number {
    if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) throw new LlmBudgetUnavailable();
    const cost = Math.ceil(input * price.costInPer1k * 1000 + output * price.costOutPer1k * 1000);
    if (!Number.isSafeInteger(cost) || cost < 0) throw new LlmBudgetUnavailable();
    return cost;
}

export function inputTokenUpperEstimate(price: ModelPrice, request: LLMRequestOptions): number {
    const payload = JSON.stringify({ messages: request.messages, systemPrompt: request.systemPrompt, tools: request.tools });
    // Images/audio are priced by provider-specific expansion, not URL/JSON length.
    if (/"(?:image_url|input_audio|image|audio)"/.test(payload)) return price.maxContextTokens;
    return Math.min(price.maxContextTokens, Buffer.byteLength(payload, 'utf8') + 1024 + request.messages.length * 128);
}

@Injectable()
export class LlmSpendGuardService {
    private readonly logger = new Logger(LlmSpendGuardService.name);
    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly cronLock: CronLockService,
    ) {}

    /**
     * Cada hora. Sin esto, `sweepStaleReservations` existía y no lo llamaba
     * nadie: una reserva que perdió su proceso seguía consumiendo presupuesto
     * para siempre. Con candado porque en este repo todo `@Cron` corre DOS
     * veces —API y worker comparten AppModule—.
     */
    @Cron('7 * * * *')
    async sweepStaleReservationsCron(): Promise<void> {
        await this.cronLock.runExclusive('llm-spend-guard.sweepStaleReservations', 3600, async () => {
            const settled = await this.sweepStaleReservations();
            if (settled > 0) {
                this.logger.warn(
                    `[LlmSpendGuard] ${settled} reserva(s) quedaron sin liquidar y se barrieron: `
                    + `son turnos cuyo proceso murió entre la reserva y la respuesta`,
                );
            }
        });
    }

    /** Every actual generate invocation (including source retries) gets its own reservation. */
    wrap(provider: ILLMProvider, tenantId: string, price: ModelPrice): ILLMProvider {
        return {
            providerName: provider.providerName,
            generate: async request => {
                const bounded = this.bounded(request);
                const id = await this.reserve(tenantId, price, bounded);
                try {
                    const response = await provider.generate(bounded, { maxRetries: 0 });
                    await this.recordUsage(id, price, response.usage);
                    return response;
                } catch (error) {
                    // Antes, cada caída del proveedor y cada salto al siguiente
                    // tier dejaba una fila inmortal en `reserved_estimate`, y
                    // como la admisión suma TODO el mes, un mes de fallas
                    // dejaba mudo a un tenant con dinero sin gastar.
                    await this.settleFailedAttempt(id, price, bounded, error);
                    throw error;
                }
            },
            generateStream: provider.generateStream.bind(provider),
        };
    }

    bounded(request: LLMRequestOptions): LLMRequestOptions {
        const maxTokens = request.maxTokens ?? 2048;
        if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new LlmBudgetUnavailable();
        return { ...request, maxTokens };
    }

    async reserve(tenantId: string, price: ModelPrice, request: LLMRequestOptions, transportAttempts = 1): Promise<string> {
        const reserved = modelCostMicro(price, inputTokenUpperEstimate(price, request), request.maxTokens ?? 2048) * transportAttempts;
        const month = new Date().toISOString().slice(0, 7);
        const id = randomUUID();
        // Fuera de la transacción a propósito: adentro, esta llamada de red se
        // hacía sosteniendo el advisory lock que serializa a TODO el tenant.
        const prior = await this.readPriorMonthSpendMicro(tenantId, month);
        try {
            await this.prisma.$transaction(async tx => {
                await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text', `llm-budget:${tenantId}:${month}`);
                const rows = await tx.$queryRawUnsafe(`SELECT p.features, t.settings
                    FROM public.tenants t JOIN public.billing_plans p ON p.slug=t.plan
                    WHERE t.id::uuid=$1::uuid AND t.is_active=true`, tenantId) as any[];
                if (!rows[0]) throw new LlmBudgetUnavailable();
                const configured = rows[0].settings?.quotaOverrides?.llmHardBudgetUsdCents
                    ?? rows[0].features?.llmHardBudgetUsdCents ?? -1;
                if (!Number.isSafeInteger(configured) || configured < -1) throw new LlmBudgetUnavailable();
                const baselineId = `opening:${tenantId}:${month}`;
                const baseline = await tx.$queryRawUnsafe('SELECT id FROM public.llm_spend_reservations WHERE id=$1', baselineId) as any[];
                if (!baseline.length) {
                    await tx.$executeRawUnsafe(`INSERT INTO public.llm_spend_reservations
                        (id,tenant_id,month,model,reserved_micro,accounted_micro,basis)
                        VALUES ($1,$2::uuid,$3,'opening_redis_estimate',$4,$4,'opening_estimate')
                        ON CONFLICT (id) DO NOTHING`, baselineId,tenantId,month,prior);
                }
                const totals = await tx.$queryRawUnsafe(`SELECT COALESCE(SUM(accounted_micro),0)::text total
                    FROM public.llm_spend_reservations WHERE tenant_id::uuid=$1::uuid AND month=$2`,tenantId,month) as any[];
                if (configured >= 0 && Number(totals[0].total) + reserved > configured * 10000) throw new LlmBudgetExceeded();
                await tx.$executeRawUnsafe(`INSERT INTO public.llm_spend_reservations
                    (id,tenant_id,month,model,reserved_micro,accounted_micro,basis)
                    VALUES ($1,$2::uuid,$3,$4,$5,$5,'reserved_estimate')`,id,tenantId,month,price.id,reserved);
            }, { timeout: 8_000, maxWait: 4_000 });
            return id;
        } catch (error) {
            // Sin saldo NO es lo mismo que no saber el saldo. Lo primero es el
            // motivo por el que existe este guardián y corta. Lo segundo es un
            // problema NUESTRO —PgBouncer saturado, una fila de plan sucia— y
            // cortar ahí deja mudos a los agentes de TODA la plataforma, no al
            // tenant que se pasó: el router relanza y aborta los cuatro tiers
            // de respaldo. Se deja pasar la llamada, se registra el hueco y el
            // Centro de Operaciones lo ve; el tope se vuelve a aplicar en la
            // llamada siguiente.
            if (error instanceof LlmBudgetExceeded) throw error;
            const reason = error instanceof LlmBudgetUnavailable
                ? 'plan/tenant row unreadable'
                : String((error as any)?.code ?? (error as any)?.message ?? 'unknown');
            this.logger.error(
                `[LlmSpendGuard] no se pudo medir el gasto del tenant ${tenantId} (${reason}); `
                + `la llamada sigue SIN contabilizar para no callar al agente`,
            );
            return `${UNMETERED_PREFIX}${id}`;
        }
    }

    async recordStream(id: string, price: ModelPrice, request: LLMRequestOptions, outputBytes: number) {
        await this.recordUsage(id, price, { promptTokens: inputTokenUpperEstimate(price,request),
            completionTokens: request.maxTokens ?? 2048, totalTokens: 0 }, 'stream_upper_estimate');
    }

    /**
     * Lo que el contador de Redis ya acumuló este mes, en micro-USD.
     *
     * El router escribe ahí en centi-USD (USD×10.000; llm-router.service.ts lo
     * declara al calcularlo), así que ×100 da micro-USD. Se lee una sola vez
     * por mes y tenant: la fila `opening_estimate` la congela.
     */
    private async readPriorMonthSpendMicro(tenantId: string, month: string): Promise<number> {
        try {
            const prior = Number(await this.redis.get(`llm:cost:${tenantId}:${month}`) ?? 0);
            if (!Number.isSafeInteger(prior) || prior < 0) return 0;
            return prior * 100;
        } catch {
            // Perder el arrastre del mes subestima el gasto; negarse a atender
            // por no poder leer Redis lo sobreactúa. Se registra el hueco.
            this.logger.error(`[LlmSpendGuard] no se pudo leer el gasto previo de ${tenantId} en ${month}`);
            return 0;
        }
    }

    /**
     * Liquidar una reserva cuyo intento falló.
     *
     * La pregunta es si el proveedor pudo habernos facturado una respuesta que
     * nunca vimos, y la respuesta depende de QUIÉN cortó:
     *
     * - **El proveedor contestó** (nos dio un status HTTP: 400, 429, 500…). No
     *   hubo completion, así que no factura salida. Se liquida con el piso de
     *   entrada. Este es el caso común —límites de tasa, caídas del proveedor,
     *   cada salto al siguiente tier— y cobrarle el máximo estimado es lo que
     *   dejaba mudo a un tenant con dinero sin gastar.
     * - **Cortamos nosotros** (timeout, aborto, conexión caída). No se puede
     *   descartar que haya generado y facturado. Se conserva la estimación
     *   completa: un timeout no puede crear presupuesto, que es la regla con
     *   la que se escribió este guardián y sigue siendo la correcta acá.
     */
    private async settleFailedAttempt(id: string, price: ModelPrice, request: LLMRequestOptions, error: unknown): Promise<void> {
        if (isUnmeteredReservation(id)) return;
        const status = Number((error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.response?.status);
        if (!Number.isInteger(status) || status < 400) return;
        try {
            const floor = modelCostMicro(price, inputTokenUpperEstimate(price, request), 0);
            await this.prisma.$executeRawUnsafe(`UPDATE public.llm_spend_reservations
                SET accounted_micro=$2, basis='failed_estimate', updated_at=clock_timestamp()
                WHERE id=$1 AND basis='reserved_estimate'`, id, floor);
        } catch {
            this.logger.error(`LLM reservation ${id} left reserved after a failed attempt; the sweep will settle it`);
        }
    }

    /**
     * Barrido de reservas que nadie liquidó porque el proceso murió entre la
     * reserva y la respuesta —un rolling restart del deploy es el caso normal,
     * no el excepcional—. Idempotente: sólo toca filas que siguen en
     * `reserved_estimate` y son más viejas que cualquier llamada viva.
     *
     * Liquida en 0, y la regla es la misma que arriba: se cobra lo que se puede
     * evidenciar. `settleFailedAttempt` tiene el pedido en la mano y puede
     * sostener el piso de entrada; el barrido sólo tiene una fila huérfana y no
     * puede sostener nada, ni siquiera que la llamada haya salido. Este libro
     * es una estimación operativa para admitir o no la próxima llamada — la
     * migración que crea la tabla lo dice en su encabezado—, no una factura:
     * contar aquí un gasto que no se puede mostrar es lo que dejaba mudo a un
     * tenant con dinero sin gastar.
     *
     * Devuelve cuántas liquidó, para que el llamador lo pueda registrar.
     */
    async sweepStaleReservations(olderThanMinutes = 30): Promise<number> {
        if (!Number.isSafeInteger(olderThanMinutes) || olderThanMinutes < 5) {
            throw new Error('sweep_window_too_short');
        }
        return this.prisma.$executeRawUnsafe(`UPDATE public.llm_spend_reservations
            SET accounted_micro=0, basis='failed_estimate', updated_at=clock_timestamp()
            WHERE basis='reserved_estimate'
              AND created_at < clock_timestamp() - ($1 || ' minutes')::interval`,
            String(olderThanMinutes));
    }

    private async recordUsage(id: string, price: ModelPrice, usage: LLMResponse['usage'], basis = 'reported_tokens_estimate'): Promise<void> {
        if (!usage || isUnmeteredReservation(id)) return; // No usage is not free usage.
        try {
            const actual = modelCostMicro(price, usage.promptTokens, usage.completionTokens);
            await this.prisma.$executeRawUnsafe(`UPDATE public.llm_spend_reservations
                SET accounted_micro=$2, basis=$3, updated_at=clock_timestamp()
                WHERE id=$1 AND basis='reserved_estimate'`,id,actual,basis);
        } catch {
            // Never retry a successful model call because accounting was unavailable.
            this.logger.error(`LLM usage reconciliation pending for reservation ${id}`);
        }
    }
}
