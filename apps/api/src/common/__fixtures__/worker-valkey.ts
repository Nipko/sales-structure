/**
 * Un keyspace de Valkey por worker de Jest.
 *
 * `jest.global-setup.ts` le da a cada worker su propia base de PostgreSQL, y
 * `jest.setup-worker-database.ts` reescribe las URLs para que ninguna suite
 * tenga que saber que los workers existen. Valkey quedó afuera: hay UNA
 * instancia y todas las suites escriben en la misma base lógica.
 *
 * Con claves derivadas de un id fresco por llamada eso no se nota — los
 * marcadores de turno, el debounce y el mutex nunca chocan. Pero una clave
 * GLOBAL sí: `DispatchRolloutService` cachea la configuración de la plataforma
 * en `dispatch:rollout`, sin tenant en el nombre, porque es un interruptor de
 * plataforma. Dos suites que la escriben con su propio tenant en la lista piloto
 * se apagan el carril durable entre ellas, y la que lee segunda ve cero filas de
 * outbox sin ninguna pista de por qué. El daño es simétrico y depende de qué
 * worker llegó antes, así que el rojo cambia de suite en cada corrida.
 *
 * La base lógica separa el keyspace del lado del servidor, que es más simple que
 * un prefijo del lado del cliente: no altera la forma de ninguna clave y no
 * sorprende a un script Lua que recibe KEYS.
 *
 * La base 0 queda LIBRE a propósito. Una suite que no adopte este helper sigue
 * exactamente donde estaba, así que adoptarlo es incremental y no hay una
 * migración que haya que terminar para que el verde vuelva.
 */

/** Bases lógicas que Valkey ofrece por defecto. */
const LOGICAL_DATABASES = 16;

/**
 * La base de este worker: 1..15, nunca 0.
 *
 * `% 15` y no `% 16` para que el worker 16 no caiga en la base compartida, que
 * es el único valor en el que este aislamiento no aislaría nada.
 */
export function workerValkeyDb(): number {
    const worker = Math.max(1, Number(process.env.JEST_WORKER_ID) || 1);
    return 1 + ((worker - 1) % (LOGICAL_DATABASES - 1));
}

/** Conexión para un `Queue`/`Worker` de BullMQ, en la base de este worker. */
export function valkeyConnection(url: URL): {
    host: string; port: number; db: number; maxRetriesPerRequest: null;
} {
    return {
        host: ['localhost', '[::1]'].includes(url.hostname) ? '127.0.0.1' : url.hostname,
        port: Number(url.port),
        db: workerValkeyDb(),
        maxRetriesPerRequest: null,
    };
}

/**
 * El doble de `ConfigService` que `RedisService` espera, en la misma base.
 *
 * Devuelve `undefined` para cualquier otra clave, que es lo que hacían los
 * dobles escritos a mano en cada suite: `RedisService` sólo lee host, puerto,
 * contraseña y base.
 */
export function valkeyConfig(url: URL): { get: (key: string) => unknown; getOrThrow: (key: string) => unknown } {
    const values: Record<string, unknown> = {
        'redis.host': ['localhost', '[::1]'].includes(url.hostname) ? '127.0.0.1' : url.hostname,
        'redis.port': Number(url.port),
        'redis.db': workerValkeyDb(),
    };
    const config = {
        get: (key: string) => values[key],
        getOrThrow: (key: string) => values[key],
    };
    return config;
}
