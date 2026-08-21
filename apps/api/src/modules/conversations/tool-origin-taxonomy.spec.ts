import {
    ASYNC_GATED_TOOL_NAMES,
    STATIC_TOOL_NAMES,
    TOOL_POLICY_REGISTRY,
    getToolPolicy,
    toolOrigin,
    toolsByOrigin,
    type ToolOrigin,
} from './tool-policy-registry';
import { staticToolsForAgentConfig } from './agent-tool-registry';
import { discountToolsForRuntime, paymentToolsForRuntime } from './payment-tool-registration';
import { identityStepUpToolNames } from './identity-step-up-registration';
import { PROVIDER_ORIGIN_TOOL_NAMES } from './effective-capability.service';
import type { VerticalToolGroup } from '@parallext/shared';

/**
 * ═══ LAS CUATRO PROCEDENCIAS TIENEN QUE SEGUIR SIENDO CUATRO ═══
 *
 * `core`, `vertical`, `provider` y `mcp` no se distinguen por lo que la tool
 * hace sino por **qué puertas tiene que pasar además**. La taxonomía se declara
 * a mano en `tool-policy-registry` —no puede derivarse de las familias sin
 * arrastrar las 25 definiciones de tools y crear un ciclo—, así que lo que la
 * mantiene honesta es esta prueba: es el único lugar que puede mirar las dos
 * listas a la vez.
 *
 * Sin esto, una tool vertical nueva cae en `core` por omisión —el default— y se
 * publicaría en las 18 industrias.
 */

/** Las 16 familias que sólo existen dentro de una industria. */
const VERTICAL_FAMILIES: readonly (VerticalToolGroup | string)[] = [
    'properties', 'tours', 'treatments', 'realEstate', 'vehicles', 'pets',
    'restaurants', 'gyms', 'education', 'insurance', 'homeServices',
    'petServices', 'vehicleRentals', 'petBoarding', 'photography',
    'professionalServices',
];

/** Las que tiene cualquier tenant, venda lo que venda. */
const CORE_FAMILIES: readonly string[] = [
    'appointments', 'catalog', 'offers', 'faqs', 'policies', 'knowledge',
    'orders', 'crm', 'ecommerce',
];

function toolsOfFamilies(families: readonly string[]): Set<string> {
    const cfg = Object.fromEntries(families.map(f => [f, { enabled: true }]));
    return new Set(staticToolsForAgentConfig(cfg).map(t => String(t.name)));
}

describe('cada tool estática declara de dónde viene', () => {
    it('las 107 tienen procedencia y ninguna queda sin clasificar', () => {
        const missing = STATIC_TOOL_NAMES.filter(
            name => !['core', 'vertical', 'provider'].includes(TOOL_POLICY_REGISTRY[name].origin),
        );
        expect(missing).toEqual([]);
    });

    it('ninguna tool estática se declara `mcp`: eso no se declara, se reconoce', () => {
        // `mcp` no tiene entrada en el registro. Si una la tuviera, sería una
        // tool nuestra disfrazada de tool de un tercero — o al revés.
        expect(STATIC_TOOL_NAMES.filter(n => TOOL_POLICY_REGISTRY[n].origin === 'mcp')).toEqual([]);
    });

    it('`toolsByOrigin` reparte todas y no repite ninguna', () => {
        const buckets: ToolOrigin[] = ['core', 'vertical', 'provider'];
        const seen = buckets.flatMap(o => [...toolsByOrigin(o)]);
        expect(seen.slice().sort()).toEqual(STATIC_TOOL_NAMES.slice().sort());
        expect(new Set(seen).size).toBe(seen.length);
    });
});

describe('la procedencia declarada coincide con la familia real', () => {
    it('toda tool de una familia vertical se declara `vertical`', () => {
        const wrong = [...toolsOfFamilies(VERTICAL_FAMILIES)].filter(
            name => toolOrigin(name) !== 'vertical',
        );
        // Publicar `file_claim` en una peluquería no es un permiso de más: es
        // una tool que ahí no significa nada.
        expect(wrong).toEqual([]);
    });

    it('ninguna tool de una familia core se declara `vertical`', () => {
        const coreTools = toolsOfFamilies(CORE_FAMILIES);
        const wrong = [...coreTools].filter(name => toolOrigin(name) === 'vertical');
        expect(wrong).toEqual([]);
    });

    it('las dos listas de familias cubren el registro entero', () => {
        // Una familia nueva que nadie clasifique dejaría a sus tools fuera de
        // las dos comprobaciones de arriba: pasarían en verde sin ser miradas.
        const covered = new Set([
            ...toolsOfFamilies(VERTICAL_FAMILIES),
            ...toolsOfFamilies(CORE_FAMILIES),
        ]);
        const uncovered = STATIC_TOOL_NAMES.filter(
            name => !covered.has(name) && toolOrigin(name) !== 'provider',
        );
        // Lo que queda fuera de las familias son las que se agregan por otro
        // camino (pagos, la llave de identidad); ninguna puede ser `vertical`.
        expect(uncovered.filter(n => toolOrigin(n) === 'vertical')).toEqual([]);
    });
});

describe('`provider` es exactamente lo que se cae cuando se cae el tercero', () => {
    it('las cuatro lecturas externas y ninguna más', () => {
        expect([...toolsByOrigin('provider')].sort()).toEqual(
            [...PROVIDER_ORIGIN_TOOL_NAMES].sort(),
        );
    });

    it('las tools de pago NO son `provider`', () => {
        // `create_payment_link` existe cuando el dueño habilita cobros, no
        // cuando conecta un PSP: el PSP se resuelve por país en runtime y la
        // tool sobrevive a cambiarlo. Lo que se cae con el proveedor es la
        // ejecución, no la publicación.
        for (const name of ['create_payment_link', 'get_payment_status', 'refund_payment']) {
            expect(toolOrigin(name)).not.toBe('provider');
        }
    });

    it('las familias nativas de esos rubros NO son `provider`', () => {
        // El primer intento gateó `restaurants` y `gyms` enteras por Toast y
        // Mindbody, y eso habría apagado a todo restaurante que nunca integró
        // nada. La familia es nativa; la lectura externa no.
        for (const name of ['get_menu', 'get_class_schedule', 'get_treatment_plan']) {
            expect(toolOrigin(name)).toBe('vertical');
        }
    });
});

describe('la excepción asincrónica está nombrada, no calculada', () => {
    it('son exactamente las de pago y la llave de identidad', () => {
        // Antes esto era "todo lo que no esté en las familias encendidas", una
        // resta que no dice cuál es la excepción ni por qué. Si crece sin que
        // alguien la piense, el contrato deja de gobernar lo que cree gobernar.
        expect([...ASYNC_GATED_TOOL_NAMES].sort()).toEqual([
            'apply_discount', 'create_payment_link', 'get_payment_status',
            'refund_payment', 'request_identity_code', 'verify_identity_code',
        ]);
    });

    it('coincide con lo que el runtime registra fuera de las familias', () => {
        // La lista se escribe a mano; esto la contrasta contra los registros
        // reales, que son los que efectivamente agregan tools al turno.
        // Todo encendido y todo disponible: el registro máximo posible, que es
        // el que la lista tiene que cubrir.
        const fullCapability = {
            statusAvailable: true, planEnabled: true, ready: true, discountsAvailable: true,
        } as any;
        const registered = new Set([
            ...paymentToolsForRuntime(
                { enabled: true, canCreateLinks: true } as any, fullCapability,
            ).map(t => String(t.name)),
            ...discountToolsForRuntime(
                { canApplyDiscount: true, maxDiscountPercent: 10 } as any, fullCapability,
            ).map(t => String(t.name)),
            ...identityStepUpToolNames(),
        ]);
        // Y no es una lista vacía pasando en verde.
        expect(registered.size).toBeGreaterThanOrEqual(4);
        for (const name of registered) {
            expect(ASYNC_GATED_TOOL_NAMES.has(name)).toBe(true);
        }
    });

    it('ninguna de ellas es `vertical`: no dependen de la industria', () => {
        for (const name of ASYNC_GATED_TOOL_NAMES) {
            expect(toolOrigin(name)).toBe('core');
        }
    });
});

describe('lo que llega con prefijo `mcp__` se reconoce sin registro', () => {
    it('cualquier nombre con el prefijo es `mcp`', () => {
        expect(toolOrigin('mcp__crm__create_deal')).toBe('mcp');
        expect(toolOrigin('mcp__lo_que_sea')).toBe('mcp');
    });

    it('y su política sigue siendo la opaca', () => {
        const policy = getToolPolicy('mcp__crm__create_deal');
        expect(policy).toMatchObject({ origin: 'mcp', commitsBusiness: true, effect: 'write' });
    });

    it('un nombre desconocido sin prefijo no tiene procedencia', () => {
        // Desconocido no cae en `core` por descarte: `core` es una concesión.
        expect(toolOrigin('inventada_por_el_modelo')).toBeUndefined();
        expect(toolOrigin(42)).toBeUndefined();
    });
});
