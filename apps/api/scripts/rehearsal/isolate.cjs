/**
 * Fase E: un proceso de medición levanta `AppModule` (el mismo grafo que el worker) para usar `RehearsalService`. Sin
 * esto, ese proceso es un worker más: procesa colas de producción (entrantes de WhatsApp incluidas) y corre los cron.
 * En E1 un cron intentó mandar un correo. Se llama ANTES de cargar `AppModule`:
 *
 *   require('./isolate.cjs').beforeBoot();  ...createApplicationContext(AppModule)...  isolate.afterBoot(app);
 */
'use strict';

function beforeBoot() {
    // BullMQ: `new Worker(..., { autorun: true })` llama a `run()`; sin `run` el worker existe pero no toma trabajos.
    const bullmq = require('bullmq');
    bullmq.Worker.prototype.run = async function measurementNoRun() { return undefined; };
    // @nestjs/schedule arranca cada @Cron con `CronJob#start` al terminar el arranque.
    const cron = require('cron');
    cron.CronJob.prototype.start = function measurementNoStart() { return undefined; };
}

/** Los @Interval y @Timeout se montan con timers; se quitan apenas termina el arranque. */
function afterBoot(app) {
    const { SchedulerRegistry } = require('@nestjs/schedule');
    let registry;
    try { registry = app.get(SchedulerRegistry, { strict: false }); } catch { return { crons: 0, intervals: 0, timeouts: 0 }; }
    const crons = [...registry.getCronJobs().values()];
    for (const job of crons) job.stop();
    const intervals = registry.getIntervals();
    for (const name of intervals) registry.deleteInterval(name);
    const timeouts = registry.getTimeouts();
    for (const name of timeouts) registry.deleteTimeout(name);
    return { crons: crons.length, intervals: intervals.length, timeouts: timeouts.length };
}

module.exports = { beforeBoot, afterBoot };
