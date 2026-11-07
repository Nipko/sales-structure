import {
    PLAN_TOOL_FAMILIES,
    TOOL_GROUP_PLAN_FEATURE,
    planAllowsToolFamily,
    planToolFamiliesAllow,
    unknownPlanToolFamilies,
} from '@parallext/shared';
import { PLAN_GATE_EXEMPT_TOOLS, TOOL_FAMILIES, planGatedFamilyForTool } from './agent-tool-registry';
import { PLAN_FEATURE_REGISTRY, unknownFeatureKeys, validatePlanFeatures } from '../throttle/plan-features.registry';

/**
 * El plan decide qué familias de tools recibe un tenant.
 *
 * Ausente = todas, para que ningún plan existente pierda nada por el cambio de
 * contrato; un arreglo = sólo esas; `payments` además sigue pidiendo
 * `customerPayments`.
 */
describe('planAllowsToolFamily', () => {
    it('ausente o null significa todas las familias', () => {
        for (const features of [{}, { toolFamilies: null }, null, undefined]) {
            expect(planAllowsToolFamily(features as any, 'appointments')).toBe(true);
            expect(planAllowsToolFamily(features as any, 'crm')).toBe(true);
        }
    });

    it('un arreglo es una lista explícita', () => {
        const features = { toolFamilies: ['faqs', 'appointments'] };
        expect(planAllowsToolFamily(features, 'appointments')).toBe(true);
        expect(planAllowsToolFamily(features, 'catalog')).toBe(false);
        expect(planAllowsToolFamily({ toolFamilies: [] }, 'faqs')).toBe(false);
    });

    it('pagos exige las dos puertas: la lista y customerPayments', () => {
        expect(TOOL_GROUP_PLAN_FEATURE.payments).toBe('customerPayments');
        expect(planAllowsToolFamily({}, 'payments')).toBe(false);
        expect(planAllowsToolFamily({ customerPayments: true }, 'payments')).toBe(true);
        expect(planAllowsToolFamily({ customerPayments: true, toolFamilies: ['faqs'] }, 'payments')).toBe(false);
        expect(planAllowsToolFamily({ customerPayments: false, toolFamilies: ['payments'] }, 'payments')).toBe(false);
        expect(planAllowsToolFamily({ customerPayments: true, toolFamilies: ['payments'] }, 'payments')).toBe(true);
        // La parte de la lista sola no mira customerPayments.
        expect(planToolFamiliesAllow({}, 'payments')).toBe(true);
    });

    it('las claves desconocidas se ignoran en runtime y se reportan', () => {
        const features = { toolFamilies: ['faqs', 'teleportation'] };
        expect(planAllowsToolFamily(features, 'faqs')).toBe(true);
        expect(planAllowsToolFamily(features, 'catalog')).toBe(false);
        expect(unknownPlanToolFamilies(features.toolFamilies)).toEqual(['teleportation']);
        expect(unknownPlanToolFamilies(null)).toEqual([]);
    });

    it('un valor que no es arreglo no recorta (la validación lo rechaza antes)', () => {
        expect(planAllowsToolFamily({ toolFamilies: 'faqs' }, 'catalog')).toBe(true);
    });
});

describe('PLAN_TOOL_FAMILIES no se separa del registro de la API', () => {
    it('son exactamente TOOL_FAMILIES más payments', () => {
        expect([...PLAN_TOOL_FAMILIES].sort()).toEqual(
            [...TOOL_FAMILIES.map(family => String(family.key)), 'payments'].sort(),
        );
    });

    it('cada tool pertenece a una sola familia, así la puerta no depende del orden', () => {
        const seen = new Map<string, string>();
        for (const family of TOOL_FAMILIES) {
            for (const tool of family.tools) {
                const name = String(tool.name);
                expect([name, seen.get(name) ?? String(family.key)]).toEqual([name, String(family.key)]);
                seen.set(name, String(family.key));
            }
        }
    });
});

describe('planGatedFamilyForTool', () => {
    it('resuelve familias estáticas, pagos y el descuento', () => {
        expect(planGatedFamilyForTool('create_appointment')).toBe('appointments');
        expect(planGatedFamilyForTool('search_faqs')).toBe('faqs');
        expect(planGatedFamilyForTool('create_payment_link')).toBe('payments');
        expect(planGatedFamilyForTool('refund_payment')).toBe('payments');
        expect(planGatedFamilyForTool('apply_discount')).toBe('ecommerce');
    });

    it('MCP, tools sin familia y el estado de un pago ya emitido nunca los recorta el plan', () => {
        expect(planGatedFamilyForTool('mcp__crm__lookup')).toBeUndefined();
        expect(planGatedFamilyForTool('register_pending_question')).toBeUndefined();
        expect(PLAN_GATE_EXEMPT_TOOLS.has('get_payment_status')).toBe(true);
        expect(planGatedFamilyForTool('get_payment_status')).toBeUndefined();
    });
});

describe('toolFamilies en el registro de features del plan', () => {
    it('es un arreglo de la categoría tools', () => {
        expect(PLAN_FEATURE_REGISTRY).toContainEqual({ key: 'toolFamilies', type: 'array', category: 'tools' });
    });

    it('acepta null, una lista conocida y la lista vacía', () => {
        for (const value of [null, ['faqs', 'payments'], []]) {
            expect(validatePlanFeatures({ toolFamilies: value })).toEqual({ unknownKeys: [], typeErrors: [] });
        }
    });

    it('rechaza familias desconocidas, duplicados y tipos inválidos', () => {
        expect(validatePlanFeatures({ toolFamilies: ['faqs', 'teleportation'] }).unknownKeys).toEqual(['toolFamilies.teleportation']);
        expect(validatePlanFeatures({ toolFamilies: ['faqs', 'faqs'] }).typeErrors).toEqual(['toolFamilies expected unique families']);
        expect(validatePlanFeatures({ toolFamilies: 'faqs' }).typeErrors).toEqual(['toolFamilies expected array']);
    });

    it('una familia muerta guardada aparece como clave desconocida del plan', () => {
        expect(unknownFeatureKeys({ toolFamilies: ['faqs', 'old_family'] })).toEqual(['toolFamilies.old_family']);
        expect(unknownFeatureKeys({ toolFamilies: null })).toEqual([]);
    });
});
