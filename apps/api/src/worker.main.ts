/**
 * Worker entry point — runs BullMQ processors and cron jobs WITHOUT HTTP server.
 *
 * This separates CPU-intensive background work (broadcast sending, nurturing,
 * outbound message retries, SLA checks) from the API server so that heavy
 * queue processing doesn't block HTTP responses or WebSocket connections.
 *
 * Same codebase as main.ts, different bootstrap: no HTTP listener, no Swagger,
 * no CORS. Only NestJS modules with @Processor and @Cron decorators are active.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

(BigInt.prototype as any).toJSON = function () { return Number(this); };

async function bootstrapWorker() {
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn', 'log'],
    });

    console.log('🔧 Parallext Worker started — processing queues and cron jobs');
    console.log('   Queues: outbound-messages, broadcast-messages, nurturing, automation-jobs');
    console.log('   Crons: SLA check (5min), stale conversations (2h)');

    // Keep alive — NestFactory.createApplicationContext doesn't listen on a port
    // but BullMQ workers and @Cron decorators run in the background.
    // The process stays alive as long as Redis connections are open.

    // Graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
        process.on(signal, async () => {
            console.log(`\n🛑 ${signal} received — shutting down worker gracefully...`);
            await app.close();
            process.exit(0);
        });
    }
}

bootstrapWorker();
