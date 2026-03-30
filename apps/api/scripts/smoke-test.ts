/**
 * Smoke test: verifies NestJS app can bootstrap without DI errors.
 * Catches circular dependencies, missing providers, undefined modules.
 *
 * Usage: npx ts-node -r tsconfig-paths/register scripts/smoke-test.ts
 * Exit code: 0 = OK, 1 = bootstrap failed
 *
 * This runs BEFORE Docker image build in CI to catch issues early.
 * It does NOT start the HTTP server or connect to real databases —
 * it only verifies the DI container can be assembled.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

async function smokeTest() {
    console.log('🔍 Smoke test: verifying NestJS module graph...');

    try {
        const app = await NestFactory.create(AppModule, {
            logger: ['error'],    // Only show errors
            abortOnError: true,   // Fail fast on DI errors
        });

        console.log('✅ All modules resolved successfully');
        await app.close();
        process.exit(0);
    } catch (error: any) {
        console.error('❌ Bootstrap failed:', error.message);

        // Extract useful info from NestJS DI errors
        if (error.message?.includes('circular dependency')) {
            console.error('💡 Hint: Use forwardRef() on BOTH sides of the circular import');
        }
        if (error.message?.includes('is undefined')) {
            console.error('💡 Hint: Check import order — a module import resolved to undefined');
        }

        process.exit(1);
    }
}

smokeTest();
