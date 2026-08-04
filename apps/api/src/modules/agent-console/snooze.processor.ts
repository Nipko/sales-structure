import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SNOOZE_QUEUE, SnoozeService } from './snooze.service';

/**
 * El consumidor que le faltaba a la cola `conversation-snooze`.
 *
 * La cola estaba registrada, el servicio encolaba el job con su `delay`, el
 * inbox ofrecía "posponer hasta mañana 9am" y la documentación la describía
 * como "auto-reactivación al vencer el plazo" — pero no existía ningún
 * `@Processor` para ella. El job vencía, quedaba en el ZSET de `delayed` sin
 * nadie que lo promoviera, y la conversación se quedaba en `status='snoozed'`
 * para siempre salvo que alguien la destapara a mano.
 *
 * El daño no era sólo que no volviera a aparecer: `resolveConversation`
 * (conversations.service.ts:844) sólo reusa conversaciones en
 * `('active','waiting_human','with_human')`, así que cuando el cliente volvía a
 * escribir se le abría una conversación NUEVA y el historial quedaba partido en
 * dos — justo con el cliente que el agente había decidido seguir después.
 *
 * No lleva CronLockService ni nada por el estilo: que la API y el worker corran
 * los dos un worker de esta cola es exactamente cómo BullMQ reparte trabajo, no
 * una duplicación.
 */
@Processor(SNOOZE_QUEUE)
export class SnoozeProcessor extends WorkerHost {
    private readonly logger = new Logger(SnoozeProcessor.name);

    constructor(private readonly snooze: SnoozeService) {
        super();
    }

    async process(job: Job<{ tenantId: string; conversationId: string }>): Promise<void> {
        const { tenantId, conversationId } = job.data || ({} as any);
        if (!tenantId || !conversationId) {
            this.logger.warn(`[Snooze] Job ${job.id} sin tenantId/conversationId — se descarta`);
            return;
        }
        // `unsnooze` intenta borrar el job de la cola; acá ya lo estamos
        // ejecutando, así que ese borrado falla sin consecuencia (lo loguea y
        // sigue). Se llama igual para tener UN solo lugar que sepa cómo se
        // despierta una conversación.
        await this.snooze.unsnooze(tenantId, conversationId);
        this.logger.log(`[Snooze] Conversación ${conversationId} despertada`);
    }
}
