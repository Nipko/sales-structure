import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NormalizedMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { INBOUND_QUEUE, InboundJobData } from './inbound-queue.constants';
import { providerMessageId, sanitizeJobId } from '../../common/utils/provider-message-id.util';
import * as Sentry from '@sentry/nestjs';

/**
 * Producer for the inbound queue.
 *
 * Webhook handlers call this and only then ACK the provider, so the message is
 * durable in Redis (AOF) before we promise the provider we have it. Previously
 * the AI turn ran as a floating promise after an early 200: an API restart
 * during a deploy killed it with nothing left to retry, and the provider —
 * already ACKed — never redelivered.
 *
 * Injects only globally-provided services, so this module stays a dependency
 * leaf every producer can import plainly (never forwardRef).
 */
@Injectable()
export class InboundQueueService {
    private readonly logger = new Logger(InboundQueueService.name);

    constructor(
        @InjectQueue(INBOUND_QUEUE) private readonly inboundQueue: Queue<InboundJobData>,
        private readonly throttle: TenantThrottleService,
    ) {}

    /**
     * Campos sin los cuales el mensaje no es procesable, cualquiera sea su
     * origen. `contactId` es a la vez la identidad del contacto y el
     * destinatario de la respuesta (`sendResponse` lo usa como `to`): vacío, no
     * hay a quién contestarle ni a quién atribuirle nada.
     *
     * OJO CON EL CONTRATO: esta cola también transporta salientes de
     * SOLO-GUARDADO (`waba_echo` e `historical` de coexistencia), así que acá
     * NO se valida `direction`. Esa exacta guarda, escrita mirando solo el
     * turno de IA, es la que dejó muda a la coexistencia.
     */
    private invalidReason(msg: NormalizedMessage): string | null {
        const missing = (v: unknown) => typeof v !== 'string' || !v.trim();
        if (missing(msg?.tenantId)) return 'tenantId';
        if (missing(msg?.contactId)) return 'contactId';
        if (missing(msg?.channelType)) return 'channelType';
        if (missing(msg?.channelAccountId)) return 'channelAccountId';
        return null;
    }

    async enqueue(msg: NormalizedMessage): Promise<void> {
        const pmid = providerMessageId(msg);

        // Frontera común a los 7 productores. Un mensaje sin remitente entraba a
        // la cola y recién reventaba en el INSERT de `contacts` (external_id NOT
        // NULL) DENTRO del worker — con el proveedor ya ACKeado: 9 ejecuciones
        // condenadas y el mensaje perdido sin llegar nunca al inbox. Validar solo
        // en el productor que falló habría dejado los otros seis igual de
        // abiertos.
        //
        // `return` y NO `throw`: lanzar propaga un 5xx al webhook y el proveedor
        // redelivera el mismo cuerpo roto, en bucle. Es un fallo permanente.
        //
        // Nunca coercionar a '' para "salvar" el mensaje: el índice único
        // (channel_type, external_id) colapsaría a todos los remitentes
        // desconocidos en UN contacto — mismo lead, misma conversación, y la IA
        // respondiéndole a alguien con el historial de otra persona.
        const invalid = this.invalidReason(msg);
        if (invalid) {
            this.logger.error(
                `[Inbound] DESCARTADO ${msg?.channelType ?? '?'}: ${invalid} vacío — ` +
                `tenant=${msg?.tenantId ?? '?'} cuenta=${msg?.channelAccountId ?? '?'} ` +
                `contactId=${JSON.stringify(msg?.contactId)} trace=${pmid || 'none'}`,
            );
            Sentry.captureMessage(`Inbound descartado: ${invalid} vacío`, {
                level: 'error',
                tags: {
                    queue: INBOUND_QUEUE,
                    channelType: msg?.channelType,
                    tenantId: msg?.tenantId,
                    reason: invalid,
                },
                extra: { pmid, contactId: msg?.contactId, channelAccountId: msg?.channelAccountId },
            });
            return;
        }

        await this.inboundQueue.add(
            'process',
            { msg, enqueuedAt: Date.now() },
            {
                priority: await this.throttle.getPriority(msg.tenantId).catch(() => 10),
                // La cola ya asentó en producción, así que se sube a 3 — que es
                // lo que usan todas las demás colas de negocio (saliente,
                // broadcast, automation).
                //
                // attempts:1 hacía definitivo cualquier error transitorio: un
                // timeout o un 5xx del proveedor LLM, un hipo de PgBouncer, una
                // caída al bajar un audio. El mensaje quedaba en `failed` y
                // nadie le contestaba nunca al cliente — en LA cola que el
                // propio monitor llama la más importante de la plataforma.
                //
                // Reintentar es seguro porque el turno es idempotente por
                // partida triple: índice único en `messages.external_id`,
                // marcador `turn:done` (que además distingue "ya respondida" de
                // "interrumpida a la mitad") y `dedupeId` del saliente.
                attempts: 3,
                // Espera creciente: si el proveedor LLM se cayó, reintentar a
                // los 2 segundos es pegarle a algo que sigue caído.
                backoff: { type: 'exponential', delay: 5000 },
                // Both dimensions: Redis runs noeviction, so an unbounded
                // completed set is a slow memory leak that ends in write errors.
                removeOnComplete: { age: 3600, count: 5000 },
                removeOnFail: { age: 86400 },
                // Deterministic id → a provider redelivery collapses onto the
                // same job instead of queueing a second turn. Sanitised because
                // BullMQ rejects ':' in a jobId (it builds Redis keys with it).
                ...(pmid
                    ? { jobId: sanitizeJobId(`in-${msg.tenantId}-${msg.channelType}-${msg.channelAccountId}-${pmid}`) }
                    : {}),
            },
        );

        // LOG, not debug: this is the handoff point between the API and the
        // worker. At debug level (invisible in production) an operator reading
        // API logs saw the webhook arrive and then nothing at all, with no way
        // to tell "enqueued, worker's turn" from "silently dropped here".
        this.logger.log(
            `[Inbound] Enqueued ${msg.channelType} from ${msg.contactId} tenant=${msg.tenantId} ` +
            `job=${pmid ? sanitizeJobId(`in-${msg.tenantId}-${msg.channelType}-${msg.channelAccountId}-${pmid}`) : 'no-dedupe'} trace=${pmid || 'none'}`,
        );
    }
}
