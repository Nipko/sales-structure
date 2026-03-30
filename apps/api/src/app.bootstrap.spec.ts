/**
 * Smoke test: verifies that the NestJS application can be created
 * without runtime errors (circular dependencies, missing providers, etc.)
 *
 * This catches issues that `tsc --noEmit` cannot detect because
 * NestJS dependency injection is resolved at runtime, not compile time.
 *
 * Run: cd apps/api && npx jest --testPathPattern=bootstrap
 */
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

// Increase timeout — module scanning can be slow
jest.setTimeout(30_000);

describe('Application Bootstrap', () => {
    it('should compile the AppModule without DI errors', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        expect(moduleRef).toBeDefined();
        await moduleRef.close();
    });
});
