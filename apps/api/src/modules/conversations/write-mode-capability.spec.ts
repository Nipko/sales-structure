/**
 * R4 (ADR 0010, pregunta abierta 5 de C0): el WRITE_MODE que declara el negocio por objeto decide los escritores;
 * los interruptores por agente (`canBook`/`canCancel`) solo restringen. Modo sombra hasta `readiness.writeModeCapability`:
 * la exclusión nueva se calcula junto a la vieja y se registra; no cambia `publishedTools`.
 */
import { EffectiveCapabilityService } from './effective-capability.service';
import { OBJECT_TOOL_GROUPS, objectWriters, writeModeDecision } from './write-mode-capability';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_cap';

const result = (objects: { object: string; writeMode: string; writeModeDeclared: boolean }[], blockingGaps: string[] = []) =>
    ({ config: { objects: objects.map(o => ({ variant: null, ...o })) }, blockingGaps }) as any;

describe('writeModeDecision (pura)', () => {
    it('cada objeto de la especificación tiene sus familias; los escritores no incluyen lecturas', () => {
        expect(Object.keys(OBJECT_TOOL_GROUPS).sort()).toEqual([
            'appointment', 'catalog_order', 'enrollment', 'food_order', 'insurance', 'lead', 'lodging_booking', 'membership',
            'pet_boarding', 'photo_session', 'professional_case', 'real_estate', 'rental', 'service_request', 'tour_booking',
        ]);
        const writers = objectWriters('appointment');
        expect(writers).toEqual(expect.arrayContaining(['create_appointment', 'cancel_appointment', 'reschedule_appointment']));
        expect(writers).not.toContain('check_availability');
        expect(objectWriters('lead')).toEqual([]);
    });

    it('sin WRITE_MODE declarado el objeto no tiene escritores (C0: sin modo = none)', () => {
        const d = writeModeDecision(result([{ object: 'appointment', writeMode: 'direct_commit', writeModeDeclared: false }]), ['create_appointment', 'check_availability'], 'shadow');
        expect(d.objects.appointment).toEqual({ mode: 'none', declared: false, preconditionsMet: true });
        expect(d.excludedWriters).toContain('create_appointment');
        expect(d.onlyNew).toEqual(['create_appointment']);
    });

    it('declarado y con precondiciones: no excluye; un bloqueante del objeto sí (falla cerrada)', () => {
        const ok = writeModeDecision(result([{ object: 'appointment', writeMode: 'direct_commit', writeModeDeclared: true }]), ['create_appointment'], 'enforce');
        expect(ok.excludedWriters).toEqual([]);
        const unmet = writeModeDecision(result([{ object: 'appointment', writeMode: 'direct_commit', writeModeDeclared: true }], ['OBJ.APPOINTMENT.AVAILABILITY_SOURCE']), ['create_appointment'], 'enforce');
        expect(unmet.objects.appointment.preconditionsMet).toBe(false);
        expect(unmet.onlyNew).toEqual(['create_appointment']);
    });
});

function build(opts: { enforce?: boolean; declared?: boolean } = {}) {
    const throttle = { getPlanFeatures: jest.fn().mockResolvedValue({ plan: 'pro' }), getTenantPlan: jest.fn().mockResolvedValue('pro') };
    const oldReadiness = { evaluate: jest.fn().mockResolvedValue({ checks: [], unmet: [], evaluatedAt: new Date().toISOString(), degraded: false }) };
    const regional = { resolve: jest.fn().mockResolvedValue({ countryPackId: 'es-CO', operatingCountry: { value: 'CO' } }) };
    const businessReadiness = {
        getCurrent: jest.fn().mockResolvedValue({ result: result([{ object: 'appointment', writeMode: 'direct_commit', writeModeDeclared: opts.declared === true }]) }),
    };
    const flags = { isFeatureEnabled: jest.fn(async (_t: string, key: string) => key === 'readiness.writeModeCapability' && opts.enforce === true) };
    const service = new EffectiveCapabilityService(throttle as any, oldReadiness as any, regional as any, undefined, businessReadiness as any, flags as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    return { service, log, businessReadiness };
}
const input = (toolsConfig: unknown) => ({ tenantId, schemaName, industry: 'salud', subType: 'dental', toolsConfig });

describe('EffectiveCapabilityService con WRITE_MODE', () => {
    it('modo sombra: publica igual que antes, registra la diferencia una vez y la deja en el contrato', async () => {
        const f = build();
        const contract = await f.service.resolve(input({ appointments: { enabled: true } }));
        expect(contract.publishedTools).toContain('create_appointment');
        expect(contract.writeModeDecision).toMatchObject({ mode: 'shadow', onlyNew: expect.arrayContaining(['create_appointment']) });
        await f.service.resolve(input({ appointments: { enabled: true } }));
        expect(f.log.mock.calls.filter(c => String(c[0]).startsWith('[capability-write-mode]'))).toHaveLength(1);
    });

    it('aplicado: sin WRITE_MODE declarado salen los escritores (con motivo y ruta al panel); las lecturas quedan', async () => {
        const contract = await build({ enforce: true }).service.resolve(input({ appointments: { enabled: true } }));
        expect(contract.publishedTools).not.toContain('create_appointment');
        expect(contract.publishedTools).toContain('check_availability');
        expect(contract.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'create_appointment', reason: 'readiness_unmet', repairRoute: '/admin/readiness' })]));
    });

    it('los interruptores por agente solo restringen: canCancel=false saca cancelar aunque el negocio lo permita; canBook=true no agrega nada', async () => {
        const restricted = await build({ enforce: true, declared: true }).service.resolve(input({ appointments: { enabled: true, canCancel: false, canBook: true } }));
        expect(restricted.publishedTools).toContain('create_appointment');
        expect(restricted.publishedTools).not.toContain('cancel_appointment');
        const notDeclared = await build({ enforce: true, declared: false }).service.resolve(input({ appointments: { enabled: true, canBook: true } }));
        expect(notDeclared.publishedTools).not.toContain('create_appointment');
    });

    it('sin la evaluación del negocio (specs a mano) el contrato no cambia', async () => {
        const throttle = { getPlanFeatures: jest.fn().mockResolvedValue({ plan: 'pro' }), getTenantPlan: jest.fn().mockResolvedValue('pro') };
        const service = new EffectiveCapabilityService(throttle as any, undefined, { resolve: jest.fn().mockResolvedValue(null) } as any);
        const contract = await service.resolve(input({ appointments: { enabled: true } }));
        expect(contract).not.toHaveProperty('writeModeDecision');
    });
});
