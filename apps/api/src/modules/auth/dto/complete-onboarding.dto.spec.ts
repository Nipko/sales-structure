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
        });

        await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    });

    it('rejects malformed nested data, unsupported plans and oversized arrays', async () => {
        const dto = plainToInstance(CompleteOnboardingDto, {
            company: { email: 'not-an-email' },
            plan: 'professional',
            goals: Array.from({ length: 26 }, (_, index) => `goal-${index}`),
        });

        const errors = await validate(dto, { whitelist: true });
        expect(errors.map((error) => error.property)).toEqual(
            expect.arrayContaining(['company', 'plan', 'goals']),
        );
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
});
