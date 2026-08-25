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
    const previousJwtSecret = process.env.JWT_SECRET;
    const previousEncryptionKey = process.env.ENCRYPTION_KEY;

    beforeAll(() => {
        // The bootstrap contract must exercise real DI without depending on a
        // developer machine's production environment file.
        process.env.JWT_SECRET = 'bootstrap-test-only-jwt-secret-at-least-32-bytes';
        process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    });

    afterAll(() => {
        if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousJwtSecret;
        if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = previousEncryptionKey;
    });

    it('should compile the AppModule without DI errors', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        expect(moduleRef).toBeDefined();
        await moduleRef.close();
    });
});
