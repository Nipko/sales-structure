import {
    PROFILE_SYSTEM_OF_RECORD_POLICIES,
    profileSystemOfRecordPolicy,
} from '@parallext/shared';
import { SystemOfRecordBoundaryService } from './system-of-record-boundary.service';
import { STATIC_TOOL_NAMES } from '../conversations/tool-policy-registry';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_sor';

const EXPECTED_PROFILES = [
    'salud/farmacia',
    'moda_belleza/estetica',
    'inmobiliaria/venta',
    'inmobiliaria/arriendo',
    'automotriz/concesionario',
    'automotriz/taller',
    'automotriz/repuestos',
    'turismo/agencia_viajes',
    'turismo/hotel',
    'turismo/alquiler_vacacional',
    'education/online',
    'servicios_profesionales/abogados',
    'servicios_profesionales/contadores',
    'servicios_profesionales/consultores',
    'technology/saas',
    'veterinaria/clinica_general',
    'seguros/broker',
    'servicios_hogar/fumigacion',
    'fotografia/producto',
].sort();

describe('registro ejecutable de system-of-record', () => {
    it('clasifica exactamente los 19 perfiles auditados, sin huecos implícitos', () => {
        expect(Object.keys(PROFILE_SYSTEM_OF_RECORD_POLICIES).sort()).toEqual(EXPECTED_PROFILES);
        for (const profile of Object.values(PROFILE_SYSTEM_OF_RECORD_POLICIES)) {
            expect(profile.readTools.length).toBeGreaterThan(0);
            expect(profile.displacedWriters.length).toBeGreaterThan(0);
            expect(profile.owner).toBe(
                profile.boundary === 'native'
                    ? 'parallly'
                    : profile.boundary === 'conditional_provider'
                        ? 'conditional_binding'
                        : 'external_provider',
            );
            expect(profile.conflict).toBe(
                profile.boundary === 'native'
                    ? 'native_atomic'
                    : profile.boundary === 'conditional_provider'
                        ? 'binding_authoritative_fail_closed'
                        : 'provider_authoritative_fail_closed',
            );
            for (const tool of [...profile.readTools, ...profile.displacedWriters]) {
                expect(STATIC_TOOL_NAMES).toContain(tool);
            }
        }
    });

    it('los 11 LIVE conservan SoR nativo hasta binding y los 8 CAP son nativos explícitos', () => {
        const policies = Object.values(PROFILE_SYSTEM_OF_RECORD_POLICIES);
        expect(policies.filter(p => p.boundary === 'conditional_provider')).toHaveLength(11);
        expect(policies.filter(p => p.boundary === 'provider_required')).toHaveLength(0);
        expect(policies.filter(p => p.boundary === 'native')).toHaveLength(8);
    });
});

function build(options: {
    settings?: any;
    schema?: string;
    mirrorRows?: any[];
    mirrorError?: Error;
} = {}) {
    const prisma: any = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue({
                schemaName: options.schema ?? schemaName,
                settings: options.settings ?? {},
            }),
        },
        executeInTenantSchema: options.mirrorError
            ? jest.fn().mockRejectedValue(options.mirrorError)
            : jest.fn().mockResolvedValue(options.mirrorRows ?? []),
    };
    const service = new SystemOfRecordBoundaryService(prisma);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return { service, prisma };
}

describe('resolución provider-neutral', () => {
    it('una frontera nativa no consulta settings ni inventa proveedor', async () => {
        const { service, prisma } = build();
        const result = await service.resolve({
            tenantId, schemaName, profileId: 'automotriz/taller',
        });
        expect(result).toMatchObject({
            owner: 'parallly', readsAvailable: true, writerOwnerVerified: true,
        });
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('un perfil de mercado sin binding conserva su SoR nativo', async () => {
        const { service, prisma } = build();
        const result = await service.resolve({
            tenantId, schemaName, profileId: 'salud/farmacia',
        });
        expect(result).toMatchObject({
            owner: 'conditional_binding', readsAvailable: true,
            writerOwnerVerified: true,
        });
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it.each(['turismo/hotel', 'turismo/alquiler_vacacional'])(
    '%s no confunde una conexión global con ownership de cada unidad', async (profileId) => {
        const { service, prisma } = build();
        const result = await service.resolve({
            tenantId, schemaName, profileId,
        });
        expect(result).toMatchObject({ readsAvailable: true, writerOwnerVerified: true });
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});

describe('lookup estable del registro', () => {
    it('no devuelve una política para perfiles fuera del backlog medido', () => {
        expect(profileSystemOfRecordPolicy('restaurantes/comida_rapida')).toBeUndefined();
    });
});
