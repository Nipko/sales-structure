import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

export interface WsRelayMessage {
    /** Socket.io room a emitir. null → evento especial que el suscriptor resuelve localmente (p.ej. fanout por-socket). */
    room: string | null;
    event: string;
    payload: any;
}

/**
 * Puente Redis pub/sub entre el worker y los gateways WebSocket.
 *
 * El worker arranca con NestFactory.createApplicationContext (sin servidor
 * HTTP), así que @WebSocketServer() nunca se puebla ahí y todo emit del
 * pipeline (newMessage, conversationUpdated, inbox:handoff…) era un no-op:
 * desde la cola de entrantes (jul 2026) ~la mitad de los turnos no llegaba en
 * vivo al dashboard ni a la app móvil, con la UI mostrando "LIVE".
 *
 * Contrato: el proceso SIN servidor publica; solo los procesos CON servidor
 * vivo se suscriben (en afterInit, que únicamente corre donde el WS existe) y
 * re-emiten al room. Así no hay doble emisión: el API emite directo y el
 * worker delega en el API vía Redis.
 */
@Injectable()
export class WsRelayService implements OnModuleDestroy {
    private readonly logger = new Logger(WsRelayService.name);
    private readonly subscribers: Redis[] = [];

    constructor(private readonly redis: RedisService) { }

    private channel(ns: string): string {
        return `ws:relay:${ns}`;
    }

    /** Fire-and-forget: un problema del relay jamás debe romper el turno. */
    publish(ns: string, msg: WsRelayMessage): void {
        this.redis.getClient()
            .publish(this.channel(ns), JSON.stringify(msg))
            .catch((e: any) => this.logger.warn(`ws-relay publish failed (${ns}): ${e?.message}`));
    }

    /**
     * Conexión dedicada por suscripción: ioredis deja una conexión en modo
     * subscriber limitada a comandos pub/sub, así que el cliente compartido
     * (BullMQ, cachés) no puede reutilizarse.
     */
    subscribe(ns: string, handler: (msg: WsRelayMessage) => void): void {
        const sub = this.redis.getClient().duplicate();
        sub.subscribe(this.channel(ns))
            .then(() => this.logger.log(`ws-relay subscribed: ${this.channel(ns)}`))
            .catch((e: any) => this.logger.error(`ws-relay subscribe failed (${ns}): ${e?.message}`));
        sub.on('message', (_ch: string, raw: string) => {
            try {
                handler(JSON.parse(raw));
            } catch (e: any) {
                this.logger.warn(`ws-relay message dropped (${ns}): ${e?.message}`);
            }
        });
        this.subscribers.push(sub);
    }

    async onModuleDestroy() {
        await Promise.all(this.subscribers.map((s) => s.quit().catch(() => { /* shutdown */ })));
    }
}
