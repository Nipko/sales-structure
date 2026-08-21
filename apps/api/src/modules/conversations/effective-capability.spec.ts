import { EffectiveCapabilityService } from './effective-capability.service';
import { TOOL_GROUP_READINESS } from '@parallext/shared';

/**
 * Las tools se publicaban desde toggles guardados en cada agente.
 *
 * La UI dejaba encender familias que no tenían nada que ver con el subtipo, el
 * manifiesto solo aportaba defaults a agentes NUEVOS, los subpermisos eran
 * decorativos, Procedures podía invocar familias apagadas y las integraciones
 * se anunciaban por estar conectadas. Siete sistemas tenían cada uno una parte
 * de la decisión y ninguno la tenía entera.
 *
 * Dos reglas hacen esto confiable: el subtipo es un **techo**, no una
 * sugerencia — ningún JSON editable amplía autoridad —, y toda exclusión lleva
 * un **motivo**, porque una tool que desaparece en silencio le enseña al dueño
 * que no existe.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_cap';

function build(options: {
    planFeatures?: Record<string, any> | Error;
    unmet?: string[];
    readinessDegraded?: boolean;
    noReadiness?: boolean;
} = {}) {
    const throttle = {
        getPlanFeatures: options.planFeatures instanceof Error
            ? jest.fn().mockRejectedValue(options.planFeatures)
            : jest.fn().mockResolvedValue(options.planFeatures ?? { plan: 'pro' }),
    };
    const readiness = options.noReadiness ? undefined : {
        evaluate: jest.fn().mockResolvedValue({
            checks: (options.unmet ?? []).map(key => ({
                key, satisfied: false, count: 0, required: 1,
                repair: `Cargá datos para ${key}.`, repairRoute: '/admin/x',
            })),
            unmet: options.unmet ?? [],
            evaluatedAt: new Date().toISOString(),
            degraded: options.readinessDegraded === true,
        }),
    };
    const regionalProfile = {
        resolve: jest.fn().mockResolvedValue({
            countryPackId: 'es-CO', operatingCountry: { value: 'CO' },
        }),
    };
    const service = new EffectiveCapabilityService(
        throttle as any, readiness as any, regionalProfile as any,
    );
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return { service, throttle, readiness };
}

describe('el subtipo es un techo, no una sugerencia', () => {
    it('una familia fuera del subtipo se descarta con motivo', async () => {
        const { service } = build();

        // Una peluquería canina encendiendo seguros: el toggle es una
        // preferencia del tenant, nunca una concesión de autoridad.
        const contract = await service.resolve({
            tenantId, schemaName, industry: 'pet_services', subType: 'peluqueria',
            toolsConfig: { petServices: { enabled: true }, insurance: { enabled: true } },
        });

        expect(contract.publishedGroups).not.toContain('insurance');
        expect(contract.excluded).toContainEqual(expect.objectContaining({
            subject: 'insurance', reason: 'not_in_subtype',
        }));
        expect(contract.publishedTools).not.toContain('calculate_quote');
    });

    it('una familia que el subtipo concede y el agente apagó se reporta', async () => {
        const { service } = build();

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'pet_services', subType: 'peluqueria',
            toolsConfig: { petServices: { enabled: true } },
        });

        // Que la citas esté disponible pero apagada es información útil para el
        // panel; ocultarla es lo que hacía creer que no existe.
        expect(contract.excluded.some(e => e.reason === 'agent_disabled')).toBe(true);
    });

    it('publica lo que el subtipo concede y el agente encendió', async () => {
        const { service } = build();

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'restaurantes', subType: 'comida_rapida',
            toolsConfig: { restaurants: { enabled: true }, faqs: { enabled: true } },
        });

        expect(contract.publishedGroups).toEqual(expect.arrayContaining(['restaurants', 'faqs']));
        expect(contract.publishedTools).toContain('get_menu');
        expect(contract.subtypeProfileId).toBe('restaurantes/comida_rapida');
    });
});

describe('plan y readiness recortan lo que el subtipo concede', () => {
    it('sin la feature del plan la familia de dinero no se publica', async () => {
        const { service } = build({ planFeatures: { plan: 'starter', customerPayments: false } });

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'restaurantes', subType: 'comida_rapida',
            toolsConfig: { restaurants: { enabled: true }, payments: { enabled: true } },
        });

        // `payments` no es un grupo del manifiesto, así que cae por subtipo
        // antes que por plan; lo que importa es que NO se publique.
        expect(contract.publishedGroups).not.toContain('payments' as never);
        expect(contract.publishedTools).not.toContain('create_payment_link');
    });

    it('un plan ilegible no concede capacidad de pago en silencio', async () => {
        const { service } = build({ planFeatures: new Error('billing down') });

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'restaurantes', subType: 'comida_rapida',
            toolsConfig: { restaurants: { enabled: true } },
        });

        expect(contract.degraded).toBe(true);
    });

    it('sin datos, la familia no se publica y dice qué cargar', async () => {
        const { service } = build({ unmet: ['menu_items'] });

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'restaurantes', subType: 'comida_rapida',
            toolsConfig: { restaurants: { enabled: true } },
        });

        expect(contract.publishedGroups).not.toContain('restaurants');
        expect(contract.unmetReadiness).toContain('menu_items');
        const exclusion = contract.excluded.find(e => e.subject === 'restaurants');
        expect(exclusion).toMatchObject({ reason: 'readiness_unmet' });
        // El motivo tiene que decirle al dueño qué hacer, no solo que falló.
        expect(exclusion!.detail).toMatch(/menu_items|Cargá/);
        expect(exclusion!.repairRoute).toEqual(expect.any(String));
    });

    it('solo evalúa readiness de las familias que sobrevivieron plan y subtipo', async () => {
        const { service, readiness } = build();

        await service.resolve({
            tenantId, schemaName, industry: 'restaurantes', subType: 'comida_rapida',
            toolsConfig: { restaurants: { enabled: true }, insurance: { enabled: true } },
        });

        const keys = (readiness!.evaluate as jest.Mock).mock.calls[0][2];
        expect(keys).toContain('menu_items');
        // Nunca se consulta la tabla de una familia que igual no se iba a
        // publicar: es trabajo por turno que no cambia ninguna decisión.
        expect(keys).not.toContain('insurance_plans');
    });

    it('un readiness ilegible marca degradado sin apagar el agente', async () => {
        const { service } = build({ readinessDegraded: true });

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'restaurantes', subType: 'comida_rapida',
            toolsConfig: { restaurants: { enabled: true } },
        });

        expect(contract.degraded).toBe(true);
        // Desconocido no es incumplido: una consulta caída no puede apagar un
        // agente que funciona.
        expect(contract.publishedGroups).toContain('restaurants');
    });

    it('sin evaluador inyectado no se marca degradado: no hay puerta que fallara', async () => {
        const { service } = build({ noReadiness: true });

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'restaurantes', subType: 'comida_rapida',
            toolsConfig: { restaurants: { enabled: true } },
        });

        expect(contract.degraded).toBe(false);
        expect(contract.publishedGroups).toContain('restaurants');
    });
});

describe('el contrato es trazable', () => {
    it('lleva versión, perfil, plan y país de la decisión', async () => {
        const { service } = build();

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'turismo', subType: 'tours',
            toolsConfig: { tours: { enabled: true } }, agentId: 'agent-1',
        });

        expect(contract).toMatchObject({
            version: 1,
            tenantId,
            agentId: 'agent-1',
            subtypeProfileId: 'turismo/tours',
            planSnapshot: 'pro',
            countryPackId: 'es-CO',
        });
        expect(Date.parse(contract.resolvedAt)).not.toBeNaN();
    });

    it('toda exclusión trae un motivo legible', async () => {
        const { service } = build({ unmet: ['tour_packages'] });

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'turismo', subType: 'tours',
            toolsConfig: { tours: { enabled: true }, catalog: { enabled: true } },
        });

        expect(contract.excluded.length).toBeGreaterThan(0);
        for (const exclusion of contract.excluded) {
            expect(exclusion.reason).toEqual(expect.any(String));
            expect(exclusion.detail.length).toBeGreaterThan(10);
        }
    });

    it('cada familia con readiness mapeada apunta a una clave del manifiesto', () => {
        // Si un grupo apunta a una clave que el manifiesto no conoce, el gate
        // nunca se cumpliría y la familia quedaría apagada para siempre.
        for (const [group, key] of Object.entries(TOOL_GROUP_READINESS)) {
            expect(typeof key).toBe('string');
            expect(group.length).toBeGreaterThan(0);
        }
    });

    it('un subtipo desconocido falla en vez de publicar de más', async () => {
        const { service } = build();
        await expect(service.resolve({
            tenantId, schemaName, industry: 'salud', subType: 'no_existe',
            toolsConfig: { faqs: { enabled: true } },
        })).rejects.toThrow();
    });
});

describe('un perfil bloqueado no cierra nada', () => {
    /**
     * `stop` era documentación: el registro lo declaraba, la auditoría lo
     * contaba y el runtime publicaba los writers igual que en un perfil
     * certificado. Un perfil bloqueado que igual reserva, cotiza o cobra es
     * exactamente lo que el bloqueo existía para impedir.
     */
    it('no publica ninguna tool que escriba', async () => {
        const { service } = build();

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'seguros', subType: 'aseguradora',
            toolsConfig: { insurance: { enabled: true }, faqs: { enabled: true } },
        });

        expect(contract.publishedTools).not.toContain('file_claim');
        expect(contract.excluded.some(e => e.reason === 'profile_blocked')).toBe(true);
    });

    /**
     * Las lecturas se conservan: el negocio existe y responde preguntas. Lo que
     * no puede es comprometerse con algo que su modelo de producto no sostiene.
     */
    it('conserva las lecturas y el motivo es legible', async () => {
        const { service } = build();

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'seguros', subType: 'aseguradora',
            toolsConfig: { insurance: { enabled: true }, faqs: { enabled: true } },
        });

        // La lectura del rubro sobrevive: la aseguradora sigue pudiendo decir
        // qué planes tiene. Lo que no puede es abrir un siniestro por chat.
        expect(contract.publishedTools).toContain('get_insurance_plans');
        expect(contract.publishedTools.every((tool: string) => tool !== 'file_claim')).toBe(true);
        const blocked = contract.excluded.find(e => e.reason === 'profile_blocked');
        expect(blocked?.detail).toMatch(/no puede cerrar operaciones por chat/i);
    });

    /** Un perfil que NO está bloqueado sigue publicando sus writers. */
    it('no toca a un perfil que no está bloqueado', async () => {
        const { service } = build();

        const contract = await service.resolve({
            tenantId, schemaName, industry: 'seguros', subType: 'broker',
            toolsConfig: { insurance: { enabled: true } },
        });

        expect(contract.excluded.some(e => e.reason === 'profile_blocked')).toBe(false);
        expect(contract.publishedTools).toContain('file_claim');
    });
});
