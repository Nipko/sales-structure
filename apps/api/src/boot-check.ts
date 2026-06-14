/**
 * CI boot smoke test — boots the REAL Nest application graph the same way
 * production does (`NestFactory.create` + `app.init()`), then shuts it down.
 *
 * Catches what `tsc` cannot: DI errors (missing providers, unresolved/circular
 * dependencies), bad module wiring, and `onModuleInit` failures.
 *
 * Why not `Test.createTestingModule({ imports: [AppModule] }).compile()`? On this
 * (large, forwardRef-heavy) graph the testing harness recurses infinitely in
 * `InstanceWrapper.cloneStaticInstance` and stack-overflows. `NestFactory.create`
 * uses the production injector path — exactly what boots cleanly in prod — so it
 * validates the graph reliably without that false failure.
 *
 * Runs in CI against ephemeral Postgres + Redis with the schema migrated; see
 * `.github/workflows/_validate.yml`. NOT shipped/imported by the running app.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
    const killer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error(`❌ Boot check timed out after ${TIMEOUT_MS / 1000}s — likely a hung onModuleInit or a missing dependency`);
        process.exit(1);
    }, TIMEOUT_MS);

    // Quiet logger: we only care about whether the graph resolves and boots.
    const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    await app.init();
    await app.close();

    clearTimeout(killer);
    // eslint-disable-next-line no-console
    console.log('✅ Boot OK — DI graph resolved and onModuleInit completed');
    process.exit(0);
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Boot check FAILED:', err);
    process.exit(1);
});
