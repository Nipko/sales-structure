import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteOnboardingDto } from './complete-onboarding.dto';

describe('CompleteOnboardingDto', () => {
    it('accepts the current onboarding wizard contract', async () => {
        const dto = plainToInstance(CompleteOnboardingDto, {
            company: {
                name: 'Clínica Norte',
                website: 'https://example.test',
                email: 'admin@example.test',
                industry: 'salud',
                subType: 'dental',
                orgSize: '1-10',
                timezone: 'America/Bogota',
                socialMedia: { instagram: '@clinicanorte' },
            },
            audiences: ['b2c'],
            goals: ['appointments', 'faq'],
            referral: 'google',
            locale: 'es',
            plan: 'starter',
            billingCycle: 'annual',
        });

        await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    });

    it('rejects malformed nested data, unsupported billing cycles and oversized arrays', async () => {
        const dto = plainToInstance(CompleteOnboardingDto, {
            company: { email: 'not-an-email' },
            plan: 'professional',
            billingCycle: 'quarterly',
            goals: Array.from({ length: 26 }, (_, index) => `goal-${index}`),
        });

        const errors = await validate(dto, { whitelist: true });
        expect(errors.map((error) => error.property)).toEqual(
            expect.arrayContaining(['company', 'billingCycle', 'goals']),
        );
        expect(errors.map((error) => error.property)).not.toContain('plan');
    });

    it('keeps supported legacy fields for backwards-compatible clients', async () => {
        const dto = plainToInstance(CompleteOnboardingDto, {
            companyName: 'Acme',
            industry: 'ecommerce',
            subType: 'marketplace',
            customerTypes: ['b2c'],
            chatReasons: ['sales'],
            businessEmail: 'ops@example.test',
            planSlug: 'starter',
        });

        await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    });

    it('accepts a new catalog-owned slug instead of enforcing a stale DTO enum', async () => {
        const dto = plainToInstance(CompleteOnboardingDto, {
            plan: 'scale-latam',
            billingCycle: 'monthly',
        });

        await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    });

    it('normalizes a supported billing country and rejects unknown country codes', async () => {
        const supported = plainToInstance(CompleteOnboardingDto, { billingCountry: ' ca ' });
        await expect(validate(supported, { whitelist: true })).resolves.toHaveLength(0);
        expect(supported.billingCountry).toBe('CA');

        const unknown = plainToInstance(CompleteOnboardingDto, { billingCountry: 'ZZ' });
        const errors = await validate(unknown, { whitelist: true });
        expect(errors.map((error) => error.property)).toContain('billingCountry');
    });
});
