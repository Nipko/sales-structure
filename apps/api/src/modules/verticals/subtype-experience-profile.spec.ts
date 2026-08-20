import {
    SUBTYPE_ALIASES,
    SUBTYPE_EXPERIENCE_PROFILES,
    VERTICAL_CAPABILITY_MANIFEST,
    VERTICAL_MANIFEST_INDUSTRIES,
    listBlockedSubtypeProfiles,
    listSubtypeExperienceProfileIds,
    listVerticalCapabilityConfigurations,
    resolveSubtypeExperienceProfile,
    subtypeProfileId,
} from '@parallext/shared';
import { VERTICAL_TOOL_CAPABILITY } from '../../common/contracts/vertical-capability-tools';
import { STATIC_TOOL_NAMES, TOOL_POLICY_REGISTRY } from '../conversations/tool-policy-registry';
import { staticToolsForAgentConfig } from '../conversations/agent-tool-registry';

/**
 * El registro único por subtipo, verificado en CI.
 *
 * El selector ofrecía 75 subtipos sobre unos 27 perfiles efectivos: una
 * etiqueta que el tenant elegía en el alta y que casi no cambiaba nada río
 * abajo. Y cada superficie contestaba por su cuenta "qué es este negocio" — el
 * manifiesto sabía capacidades, el resolver de persona sabía una plantilla, el
 * sidebar sabía rutas, marketing sabía un claim, y ninguno coincidía.
 *
 * Estas pruebas son la puerta de la Fase 1: cierran la exhaustividad de los 76
 * perfiles y prohíben que una diferencia viva en 76 entradas cuando puede vivir
 * en un componente compartido — el riesgo de "explosión de 76 forks" que el
 * propio plan registra.
 */

const CANONICAL_PROFILE_COUNT = 76;

describe('conteos canónicos', () => {
    it('hay exactamente 18 verticales, 75 subtipos y `otro`', () => {
        expect(VERTICAL_MANIFEST_INDUSTRIES).toHaveLength(18);

        const ids = listSubtypeExperienceProfileIds();
        expect(ids).toHaveLength(CANONICAL_PROFILE_COUNT);

        const withSubtype = ids.filter(id => !id.endsWith('/__none__'));
        expect(withSubtype).toHaveLength(75);
        expect(ids.filter(id => id.endsWith('/__none__'))).toEqual(['otro/__none__']);
    });

    it('el registro cubre exactamente las configuraciones del manifiesto', () => {
        // Sin agrupar hermanos: cada subtipo del manifiesto tiene su perfil, y
        // ningún perfil inventa un subtipo que el manifiesto no conoce.
        const manifestIds = listVerticalCapabilityConfigurations()
            .map(c => subtypeProfileId(c.industry, c.subtype));
        const profileIds = listSubtypeExperienceProfileIds();

        expect(new Set(profileIds)).toEqual(new Set(manifestIds));
    });

    it('cada industria del manifiesto tiene al menos un perfil', () => {
        for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
            const profiles = listSubtypeExperienceProfileIds()
                .filter(id => id.startsWith(`${industry}/`));
            expect(profiles.length).toBeGreaterThan(0);
        }
    });

    it('los subtipos declarados por el manifiesto coinciden con los del registro', () => {
        for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
            const entry = VERTICAL_CAPABILITY_MANIFEST[industry];
            const expected = entry.subtypes.length
                ? entry.subtypes.map(s => `${industry}/${s}`)
                : [`${industry}/__none__`];
            const actual = listSubtypeExperienceProfileIds()
                .filter(id => id.startsWith(`${industry}/`));
            expect(new Set(actual)).toEqual(new Set(expected));
        }
    });
});

describe('cada perfil declara lo que se puede vender de él', () => {
    const profiles = Object.entries(SUBTYPE_EXPERIENCE_PROFILES);

    it('todos declaran estrategia, ola, alcance y referente', () => {
        for (const [id, profile] of profiles) {
            expect(profile.strategy).toEqual(expect.any(String));
            expect([0, 1, 2, 3, 4]).toContain(profile.wave);
            expect(profile.scope).toEqual(expect.any(String));
            expect(profile.benchmark.length).toBeGreaterThan(0);
            expect(profile.primaryGap.length).toBeGreaterThan(0);
            expect(profile.exclusions.length).toBeGreaterThan(0);
            expect(id).toBe(`${profile.industry}/${profile.subtype}`);
        }
    });

    it('un perfil bloqueado siempre dice por qué', () => {
        const blocked = listBlockedSubtypeProfiles();
        // Si esto llega a cero sin una decisión registrada, alguien despublicó
        // el bloqueo en vez de resolverlo.
        expect(blocked.length).toBeGreaterThan(0);
        for (const profile of blocked) {
            expect(profile.strategy).toBe('stop');
            expect(profile.blockedReason).toEqual(expect.any(String));
            // Un motivo de una línea no explica nada a quien lo hereda.
            expect(profile.blockedReason!.length).toBeGreaterThan(80);
        }
    });

    it('solo un perfil bloqueado lleva motivo de bloqueo', () => {
        for (const profile of Object.values(SUBTYPE_EXPERIENCE_PROFILES)) {
            if (profile.strategy !== 'stop') {
                expect(profile.blockedReason).toBeUndefined();
            }
        }
    });

    it('las seis taxonomías que el plan marcó como ambiguas están bloqueadas o migradas', () => {
        // Las decisiones del dueño: construcción, fintech y marketplace se
        // definen antes de venderse; aseguradora es integración sobre PAS;
        // wedding planner sale de fotografía; grooming vive en Pet Services.
        for (const id of [
            'inmobiliaria/construccion',
            'finanzas/fintech',
            'retail/marketplace',
            'seguros/aseguradora',
            'fotografia/wedding_planner',
        ]) {
            expect(SUBTYPE_EXPERIENCE_PROFILES[id as never]).toBeDefined();
            expect((SUBTYPE_EXPERIENCE_PROFILES as any)[id].strategy).toBe('stop');
        }
        // Grooming resuelve a la experiencia de Pet Services, no a la clínica.
        expect(resolveSubtypeExperienceProfile('veterinaria', 'peluqueria_canina').id)
            .toBe('pet_services/peluqueria');
    });

    it('un alcance de operación exige un objeto operativo, no un lead', () => {
        for (const profile of Object.values(SUBTYPE_EXPERIENCE_PROFILES)) {
            if (!profile.scope.startsWith('operacion')) continue;
            const resolved = resolveSubtypeExperienceProfile(profile.industry, profile.subtype);
            // Vender "operación" sobre un embudo es exactamente la confusión que
            // el plan prohíbe: una oportunidad del CRM no es una reserva.
            expect(resolved.capability.primaryObject).not.toBe('lead');
        }
    });

    it('un perfil MISCLASS no puede prometer que OPERA lo que clasifica mal', () => {
        // MISCLASS no siempre significa "no vendible": taller, agencia de
        // viajes, universitaria, arquitectos y foto de producto heredan el
        // producto de otro subtipo, y eso limita la PROFUNDIDAD que pueden
        // prometer, no su existencia. Lo que no pueden hacer es venderse como
        // operación del objeto que confunden.
        const misclassified = Object.entries(SUBTYPE_EXPERIENCE_PROFILES)
            .filter(([, p]) => p.alerts.includes('MISCLASS'));
        expect(misclassified.length).toBeGreaterThan(0);

        for (const [id, profile] of misclassified) {
            if (profile.strategy === 'stop') continue;
            if (profile.strategy === 'migrate') {
                // Migrado: el id resuelve a la experiencia correcta.
                expect(profile.migratesTo).toEqual(expect.any(String));
                expect(SUBTYPE_ALIASES[id]).toBe(profile.migratesTo);
                continue;
            }
            expect(profile.scope.startsWith('operacion')).toBe(false);
        }
    });

    it('un perfil migrado resuelve a su destino y no queda bloqueado', () => {
        const migrated = Object.entries(SUBTYPE_EXPERIENCE_PROFILES)
            .filter(([, p]) => p.strategy === 'migrate');
        expect(migrated.length).toBeGreaterThan(0);

        for (const [id, profile] of migrated) {
            expect(profile.migratesTo).toEqual(expect.any(String));
            expect(profile.migrationNote).toEqual(expect.any(String));
            expect(profile.blockedReason).toBeUndefined();
            const [industry, subtype] = id.split('/');
            const resolved = resolveSubtypeExperienceProfile(industry, subtype);
            expect(resolved.id).toBe(profile.migratesTo);
            // Migrar no es bloquear: el tenant conserva un producto que funciona.
            expect(resolved.commercialisable).toBe(true);
        }
    });
});

describe('el registro compone, no duplica', () => {
    it('resuelve capacidades y rutas desde el manifiesto vivo', () => {
        const dental = resolveSubtypeExperienceProfile('salud', 'dental');
        expect(dental.capability.capabilities).toContain('appointment_booking');
        expect(dental.capability.routes).toContain('/admin/appointments');
        expect(dental.manifestVersion).toBe(2);
    });

    it('no guarda su propia copia de capacidades ni rutas', () => {
        for (const profile of Object.values(SUBTYPE_EXPERIENCE_PROFILES)) {
            // Si estas claves aparecieran acá habría dos definiciones de lo
            // mismo, y la de 76 entradas sería la que envejece.
            expect(profile).not.toHaveProperty('capabilities');
            expect(profile).not.toHaveProperty('routes');
            expect(profile).not.toHaveProperty('toolGroups');
            expect(profile).not.toHaveProperty('readiness');
        }
    });

    it('un id desconocido falla en vez de caer a un perfil por defecto', () => {
        expect(() => resolveSubtypeExperienceProfile('salud', 'no_existe')).toThrow();
        expect(() => resolveSubtypeExperienceProfile('inventada', 'x')).toThrow();
    });

    it('los alias legacy siguen resolviendo, sin volver al selector', () => {
        for (const [legacy, target] of Object.entries(SUBTYPE_ALIASES)) {
            const [industry, subtype] = legacy.split('/');
            const resolved = resolveSubtypeExperienceProfile(industry, subtype);
            expect(resolved.id).toBe(target);
        }
        // Los ids pre-manifiesto no son perfiles publicables.
        for (const legacy of ['moda_belleza/boutique', 'pet_services/tienda', 'restaurantes/delivery']) {
            expect(listSubtypeExperienceProfileIds()).not.toContain(legacy);
        }
    });

    it('`commercialisable` sigue al perfil RESUELTO, no al id pedido', () => {
        for (const [id, profile] of Object.entries(SUBTYPE_EXPERIENCE_PROFILES)) {
            const resolved = resolveSubtypeExperienceProfile(profile.industry, profile.subtype);
            const target = SUBTYPE_ALIASES[id] ?? id;
            const targetProfile = SUBTYPE_EXPERIENCE_PROFILES[target];
            expect(resolved.commercialisable).toBe(targetProfile.strategy !== 'stop');
        }
    });
});

describe('capacidad, tools y policies no pueden divergir', () => {
    it('todo grupo de tools del manifiesto mapea a una capability', () => {
        for (const config of listVerticalCapabilityConfigurations()) {
            const resolved = resolveSubtypeExperienceProfile(config.industry, config.subtype);
            for (const group of resolved.capability.toolGroups) {
                expect(VERTICAL_TOOL_CAPABILITY[group]).toBeDefined();
            }
        }
    });

    it('cada grupo publica tools reales, y todas tienen policy', () => {
        for (const group of Object.keys(VERTICAL_TOOL_CAPABILITY)) {
            const tools = staticToolsForAgentConfig({ [group]: { enabled: true } });
            // Un grupo sin tools es una capacidad prometida que nadie puede usar.
            expect(tools.length).toBeGreaterThan(0);
            for (const tool of tools) {
                expect(STATIC_TOOL_NAMES).toContain(tool.name);
                expect(TOOL_POLICY_REGISTRY[tool.name!]).toBeDefined();
            }
        }
    });

    it('ningún writer se publica sin confirmación ni idempotencia', () => {
        for (const name of STATIC_TOOL_NAMES) {
            const policy = TOOL_POLICY_REGISTRY[name];
            if (policy.effect !== 'write') continue;
            expect(policy.confirmation).not.toBe('required_missing');
            expect(policy.idempotency).not.toBe('missing');
            expect(policy.assuranceEnforcement).not.toBe('missing');
            expect(policy.humanApproval).not.toBe('required_missing');
        }
    });

    it('un perfil con capability de tools tiene al menos un grupo que la sirve', () => {
        const servedBy = new Map<string, string[]>();
        for (const [group, capability] of Object.entries(VERTICAL_TOOL_CAPABILITY)) {
            servedBy.set(capability, [...(servedBy.get(capability) || []), group]);
        }
        for (const config of listVerticalCapabilityConfigurations()) {
            const resolved = resolveSubtypeExperienceProfile(config.industry, config.subtype);
            for (const group of resolved.capability.toolGroups) {
                const capability = VERTICAL_TOOL_CAPABILITY[group];
                // El grupo que el manifiesto asigna debe estar dentro de las
                // capacidades efectivas: publicar una familia fuera de la
                // capacidad es lo que permitía toggles sin autoridad.
                expect(resolved.capability.capabilities).toContain(capability);
                expect(servedBy.get(capability)).toContain(group);
            }
        }
    });
});
