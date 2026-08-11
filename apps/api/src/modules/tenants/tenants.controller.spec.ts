import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForbiddenException } from '@nestjs/common';
import { CreateTenantDto, TenantsController, UpdateTenantDto } from './tenants.controller';

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

describe('TenantsController tenant detail authorization', () => {
    const ownTenantId = '11111111-1111-4111-8111-111111111111';
    const otherTenantId = '22222222-2222-4222-8222-222222222222';

    function setup() {
        const tenantsService = {
            findById: jest.fn(async (id: string) => ({ id, name: 'Tenant' })),
        };
        const controller = new TenantsController(
            tenantsService as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );
        return { controller, tenantsService };
    }

    it('allows tenant_admin to read only its own tenant', async () => {
        const { controller, tenantsService } = setup();

        await expect(controller.findById(ownTenantId, {
            role: 'tenant_admin',
            tenantId: ownTenantId,
        })).resolves.toEqual({
            success: true,
            data: { id: ownTenantId, name: 'Tenant' },
        });
        expect(tenantsService.findById).toHaveBeenCalledWith(ownTenantId, {
            role: 'tenant_admin',
            tenantId: ownTenantId,
        });

        await expect(controller.findById(otherTenantId, {
            role: 'tenant_admin',
            tenantId: ownTenantId,
        })).rejects.toBeInstanceOf(ForbiddenException);
        expect(tenantsService.findById).toHaveBeenCalledTimes(1);
    });

    it('preserves super_admin access to an arbitrary tenant', async () => {
        const { controller, tenantsService } = setup();

        await expect(controller.findById(otherTenantId, {
            role: 'super_admin',
            tenantId: null,
        })).resolves.toEqual({
            success: true,
            data: { id: otherTenantId, name: 'Tenant' },
        });
        expect(tenantsService.findById).toHaveBeenCalledWith(otherTenantId, {
            role: 'super_admin',
            tenantId: null,
        });
    });
});
