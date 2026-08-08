import { VERTICAL_CAPABILITY_MANIFEST, VERTICAL_MANIFEST_INDUSTRIES } from '@parallext/shared';
import { ServicesService } from '../appointments/services.service';
import { getVerticalDefinition } from '../verticals/vertical-definitions';
import {
    resolveVerticalAgendaSeedContract,
    VerticalsService,
} from '../verticals/verticals.service';
import {
    buildVerticalCommercialUnitsMatrix,
    VERTICAL_COMMERCIAL_UNITS_LAYER,
} from './vertical-commercial-units-matrix';

describe('vertical commercial-units contract/static matrix', () => {
    it('derives exactly 18 industries, 75 subtypes and 76 operational configurations', () => {
        const matrix = buildVerticalCommercialUnitsMatrix();

        expect(matrix.layer).toBe(VERTICAL_COMMERCIAL_UNITS_LAYER);
        expect(matrix.bootstrapCertified).toBe(false);
        expect(matrix.dimensions).toEqual({
            industries: 18,
            subtypes: 75,
            operationalConfigurations: 76,
        });
        expect(matrix.industries).toHaveLength(18);
        expect(matrix.configurations).toHaveLength(76);
        expect(matrix.configurations.filter((row) => row.subtype !== null)).toHaveLength(75);
        expect(matrix.failures).toEqual([]);
    });

    it('keeps explicit minutes/currency contracts across every resolved subtype seed', () => {
        const matrix = buildVerticalCommercialUnitsMatrix();

        for (const configuration of matrix.configurations) {
            expect(configuration.durationUnit).toBe('minutes');
            expect(configuration.currencySource).toBe('vertical_definition');
            if (!configuration.agendaAllowed) {
                expect(configuration.seededServices).toEqual([]);
            }
            for (const service of configuration.configuredServices) {
                expect(Number.isInteger(service.durationMinutes)).toBe(true);
                expect(service.durationMinutes).toBeGreaterThan(0);
                expect(service.currency).toMatch(/^[A-Z]{3}$/);
            }
        }

        const tourismHotel = matrix.configurations.find(
            (row) => row.industry === 'turismo' && row.subtype === 'hotel',
        );
        const petHotel = matrix.configurations.find(
            (row) => row.industry === 'pet_services' && row.subtype === 'hotel',
        );
        expect(tourismHotel).toMatchObject({ agendaAllowed: false, seededServices: [] });
        expect(petHotel?.seededServices.some(
            (service) => service.durationType === 'open' && service.durationMinutes === 1_440,
        )).toBe(true);
    });

    it('passes durationMinutes, currency and durationType unchanged into services persistence', async () => {
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
        const verticals = new VerticalsService(prisma as any, {} as any, {} as any);
        jest.spyOn((verticals as any).logger, 'debug').mockImplementation(() => undefined);

        for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
            const definition = getVerticalDefinition(industry);
            const subtypes = VERTICAL_CAPABILITY_MANIFEST[industry].subtypes.length
                ? VERTICAL_CAPABILITY_MANIFEST[industry].subtypes
                : [null];
            for (const subtype of subtypes) {
                const contract = resolveVerticalAgendaSeedContract(definition, subtype);
                if (!contract.agendaAllowed) continue;
                prisma.$queryRawUnsafe.mockClear();
                await (verticals as any).seedServices(
                    'tenant_contract',
                    { ...definition, services: contract.services },
                    'es',
                );
                expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(contract.services.length);
                contract.services.forEach((service, index) => {
                    const args = prisma.$queryRawUnsafe.mock.calls[index];
                    expect(args[3]).toBe(service.durationMinutes);
                    expect(args[5]).toBe(service.currency);
                    expect(args[8]).toBe(service.durationType || 'fixed');
                });
            }
        }
    });
});

describe('bookable-service commercial unit writer', () => {
    it('normalizes a configured currency and numeric minute input before persistence', async () => {
        const prisma = {
            executeInTenantSchema: jest.fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{
                    id: '11111111-1111-4111-8111-111111111111',
                    name: 'Consulta',
                    description: null,
                    duration_minutes: 45,
                    duration_minutes_max: null,
                    duration_type: 'fixed',
                    buffer_minutes: 0,
                    price: '100',
                    currency: 'MXN',
                    color: '#6c5ce7',
                    is_active: true,
                    sort_order: 0,
                    category: null,
                    max_concurrent: 1,
                    rebook_after_days: null,
                    required_fields: [],
                }]),
        };
        const service = new ServicesService(prisma as any, { del: jest.fn() } as any);

        const created = await service.create('tenant_contract', {
            name: 'Consulta',
            durationMinutes: '45',
            currency: ' mxn ',
            price: 100,
        });

        const insertParams = prisma.executeInTenantSchema.mock.calls[0][2];
        expect(insertParams[3]).toBe(45);
        expect(insertParams[6]).toBe('MXN');
        expect(created).toMatchObject({ durationMinutes: 45, currency: 'MXN' });
    });

    it.each([
        { durationMinutes: 0 },
        { durationMinutes: -5 },
        { durationMinutes: 1.5 },
    ])('rejects invalid fixed durations before touching the database: %j', async (input) => {
        const prisma = { executeInTenantSchema: jest.fn() };
        const service = new ServicesService(prisma as any, { del: jest.fn() } as any);

        await expect(service.create('tenant_contract', { name: 'Invalid', ...input }))
            .rejects.toThrow('durationMinutes must be a positive integer');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});
