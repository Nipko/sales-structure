import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantDto, UpdateTenantDto } from './tenants.controller';

describe('TenantsController DTO contracts', () => {
    it('preserves the canonical vertical pair through the global whitelist', async () => {
        const dto = plainToInstance(CreateTenantDto, {
            name: 'Clínica Norte',
            slug: 'clinica-norte',
            industry: 'salud',
            subType: 'dental',
            language: 'es-CO',
            plan: 'pro',
            ownerEmail: 'owner@clinicanorte.com',
            ownerFirstName: 'Laura',
            ownerLastName: 'Gómez',
            unexpected: 'remove-me',
        });

        const errors = await validate(dto, { whitelist: true });

        expect(errors).toHaveLength(0);
        expect(dto).toEqual(expect.objectContaining({
            industry: 'salud',
            subType: 'dental',
            plan: 'pro',
        }));
        expect((dto as any).unexpected).toBeUndefined();
    });

    it('rejects the obsolete professional plan', async () => {
        const dto = plainToInstance(CreateTenantDto, {
            name: 'Clínica Norte',
            slug: 'clinica-norte',
            industry: 'salud',
            subType: 'dental',
            plan: 'professional',
            ownerEmail: 'owner@clinicanorte.com',
            ownerFirstName: 'Laura',
        });

        const errors = await validate(dto, { whitelist: true });

        expect(errors.some((error) => error.property === 'plan')).toBe(true);
    });

    it('accepts subtype changes in the edit contract', async () => {
        const dto = plainToInstance(UpdateTenantDto, {
            industry: 'education',
            subType: 'idiomas',
        });

        await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    });

    it('rejects language tags outside the supported tenant locales', async () => {
        const dto = plainToInstance(UpdateTenantDto, { language: 'xx-ZZ' });

        const errors = await validate(dto, { whitelist: true });

        expect(errors.some((error) => error.property === 'language')).toBe(true);
    });
});
