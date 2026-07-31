import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Hace que un @Cron corra en UNA sola instancia.
 *
 * ── El problema ──
 * La API y el worker arrancan el MISMO AppModule (Dockerfile.api -> dist/main.js,
 * Dockerfile.worker -> dist/worker.main.js), y AppModule registra
 * ScheduleModule.forRoot(). O sea que TODO metodo decorado con @Cron se ejecuta
 * dos veces en produccion, en dos procesos distintos, disparado por la misma
 * expresion cron y por lo tanto con milisegundos de diferencia.
 *
 * Una auditoria de los 48 crons confirmo 28 con efecto duplicado real: campañas
 * enviadas dos veces a cada destinatario, recordatorios de cita duplicados al
 * cliente final (con doble cargo de plantilla de Meta), respuestas de reseña
 * pisandose en Google, embeddings del RAG duplicados. Casi todos comparten el
 * mismo patron: SELECT de pendientes -> procesar -> marcar como hechos. El
 * marcado final NO protege nada, porque las dos instancias leen la lista antes
 * de que cualquiera escriba.
 *
 * ── Por que un lock y no "crons solo en el worker" ──
 * Mover los crons al worker es una linea y arregla los 28 de una... y rompe otra
 * cosa: EventEmitter2 es in-process y socket.io no tiene adaptador Redis, asi
 * que un cron que emite un evento consumido por un gateway WebSocket solo llega
 * a los navegadores conectados si corre en la API. El escalamiento de SLA del
 * inbox es exactamente ese caso. El lock preserva la topologia actual.
 *
 * ── Dos decisiones que no son obvias ──
 *
 * 1. FALLA ABIERTO. Si Redis no responde, se EJECUTA igual. Un mensaje duplicado
 *    es malo; que se caigan en silencio los recordatorios, la facturacion y los
 *    backups de todos los tenants porque Redis parpadeo es mucho peor.
 *
 * 2. NO SE LIBERA AL TERMINAR. El lock expira solo. Liberarlo al final
 *    reabriria la ventana: el trabajo suele tardar menos que el desfase entre
 *    los dos procesos, asi que un gemelo que arranca tarde volveria a entrar.
 *    Por eso el TTL tiene que ser menor que el intervalo del cron (si no, se
 *    saltea la corrida siguiente) y mayor que ese desfase. Regla practica:
 *    ~la mitad del intervalo, con un piso de 30s.
 *
 * ── Como se aplica ──
 * El metodo original NO se toca ni se renombra: pierde el @Cron y lo recibe un
 * metodo nuevo `<nombre>Cron` que lo envuelve. Asi los controllers que invocan
 * el metodo a mano (por ejemplo un super_admin apretando "reconciliar ahora")
 * siguen llamandolo igual y SIN lock, que es lo correcto: una accion manual
 * tiene que correr siempre.
 */
@Injectable()
export class CronLockService {
    private readonly logger = new Logger(CronLockService.name);

    /** El proceso worker se identifica por su entrypoint, sin configuracion nueva. */
    private readonly isWorker = (process.argv[1] || '').includes('worker.main');

    constructor(private readonly redis: RedisService) {}

    /**
     * @param name        identificador estable del cron (modulo.metodo)
     * @param ttlSeconds  ver la regla del TTL arriba
     * @param fn          el cuerpo del cron
     * @param opts.prefer que proceso deberia ganar cuando importa quien corre
     */
    async runExclusive(
        name: string,
        ttlSeconds: number,
        fn: () => Promise<unknown>,
        opts?: { prefer?: 'api' | 'worker' },
    ): Promise<void> {
        // Cuando el resultado tiene que llegar a algo que vive en un proceso
        // concreto (un gateway WebSocket con clientes conectados), el proceso no
        // preferido espera antes de intentar. No es una garantia dura —no la
        // necesita— pero hace que el preferido gane practicamente siempre.
        if (opts?.prefer) {
            const amPreferred = opts.prefer === (this.isWorker ? 'worker' : 'api');
            if (!amPreferred) await new Promise(r => setTimeout(r, 1500));
        }

        const key = `lock:cron:${name}`;
        let acquired = true;
        try {
            acquired = await this.redis.acquireLock(key, ttlSeconds);
        } catch (err: any) {
            // Falla abierto: ver la nota 1 de arriba.
            this.logger.warn(`[CronLock] Redis no respondio para '${name}' (${err.message}) — se ejecuta igual`);
            acquired = true;
        }

        if (!acquired) {
            this.logger.debug(`[CronLock] '${name}' ya lo esta corriendo la otra instancia — se omite`);
            return;
        }

        await fn();
    }
}
