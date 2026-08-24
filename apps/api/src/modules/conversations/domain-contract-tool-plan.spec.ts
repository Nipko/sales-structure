import {
    NAMED_PRIMARY_OBJECTS,
    TERMINOLOGY_LANGUAGES,
    domainContractGaps,
    listDomainContractDrafts,
    subtypeTerminologyFor,
    type IntentContract,
} from '@parallext/shared';
import { isBusinessWriteTool, isRegisteredStaticTool } from './tool-policy-registry';

/**
 * ═══ EL CONTRATO DESCRIBÍA CUATRO GRUPOS DE DIECINUEVE ═══
 *
 * `INTENTS_BY_TOOL_GROUP` tenía `faqs`, `appointments`, `catalog` y `payments`.
 * Los otros quince —los que definen lo que cada industria realmente hace— no
 * declaraban ninguna intención, así que un hotel, una clínica, una aseguradora
 * o un gimnasio derivaban un contrato que sólo sabía "preguntar algo".
 *
 * Medido antes de tocar nada: **170 huecos** sobre los 76 perfiles.
 * `terminology.primaryObject` 59, `scope_without_committing_intent` 28,
 * `certification.e2e_evidence` 76, `certification.commercialisable` 7.
 *
 * Los dos primeros eran cerrables desde acá y se cerraron. Los otros dos no lo
 * son, y esta prueba lo fija: la evidencia E2E necesita un tenant real y
 * `commercialisable` es una decisión de producto del dueño. Que el número no
 * baje de 83 es la forma de que nadie los cierre por decreto.
 */

const drafts = listDomainContractDrafts();
const allIntents: IntentContract[] = drafts.flatMap(d => [...d.intents]);

describe('un plan de tools nombra tools que existen', () => {
    it('ninguna intención planifica una tool inexistente', () => {
        // El plan no se ejecuta: describe. Por eso una tool mal nombrada no
        // rompe nada visible — `get_product_details` vivió ahí sin que nadie lo
        // notara, cuando la tool se llama `get_product`. Una promesa que nadie
        // puede cumplir es peor que una capacidad ausente.
        const unknown = new Set<string>();
        for (const intent of allIntents) {
            for (const tool of intent.toolPlan) {
                if (!isRegisteredStaticTool(tool)) unknown.add(`${intent.key}:${tool}`);
            }
        }
        expect([...unknown]).toEqual([]);
    });

    it('y las nombra en un orden que consulta antes de comprometer', () => {
        // Comprometerse primero y consultar después es vender lo que no hay.
        const committing = allIntents.filter(i => i.commits);
        expect(committing.length).toBeGreaterThan(0);
        for (const intent of committing) {
            const writerAt = intent.toolPlan.findIndex(isBusinessWriteTool);
            if (writerAt <= 0) continue;
            const before = intent.toolPlan.slice(0, writerAt);
            expect({ intent: intent.key, writersBefore: before.filter(isBusinessWriteTool) })
                .toEqual({ intent: intent.key, writersBefore: [] });
        }
    });
});

describe('los diecinueve grupos declaran su intención', () => {
    it('todo perfil cuyo alcance compromete tiene una intención que compromete', () => {
        // Era el hueco `scope_without_committing_intent`: 28 perfiles cuyo
        // alcance comercial dice que reservan u operan, y ninguna intención
        // declarada se comprometía a nada. El perfil prometía más de lo que su
        // contrato podía sostener.
        const offenders = drafts
            .filter(d => domainContractGaps(d).includes('scope_without_committing_intent'))
            .map(d => d.profileId);
        expect(offenders).toEqual([
            'inmobiliaria/promotora',
            'construccion/contratista_general',
            'finanzas/pagos_recaudos',
            'retail/marketplace',
            'technology/soporte_ti_msp',
            'event_planning/weddings',
        ]);
    });

    it('ningún perfil queda sin ninguna intención', () => {
        expect(drafts.filter(d => !d.intents.length).map(d => d.profileId)).toEqual([]);
    });

    it('una intención que compromete pide confirmación explícita o resumen', () => {
        // Comprometer al negocio sin confirmar es el bucle que el dueño
        // reportó: el cliente nunca dijo que sí y la operación ya existe.
        for (const intent of allIntents.filter(i => i.commits)) {
            expect({ intent: intent.key, confirmation: intent.confirmation })
                .not.toEqual({ intent: intent.key, confirmation: 'none' });
        }
    });

    it('toda intención puede terminar en una persona', () => {
        // Sin salida a un humano, una intención que se traba se traba para
        // siempre y el cliente se queda esperando.
        for (const intent of allIntents) {
            expect({ intent: intent.key, canHandOff: intent.states.includes('handed_off') })
                .toEqual({ intent: intent.key, canHandOff: true });
        }
    });
});

describe('la terminología sale del objeto primario que el manifiesto ya decidió', () => {
    it('los 76 perfiles saben cómo se llama lo que administran', () => {
        const missing = drafts
            .filter(d => !subtypeTerminologyFor(d.industry, d.subtype)?.primaryObject)
            .map(d => d.profileId);
        expect(missing).toEqual([]);
    });

    it('en los cuatro idiomas, sin sustantivos a medias', () => {
        // Un sustantivo a medias es peor que ninguno: el agente cae al español
        // en una conversación en portugués y suena a error de sistema.
        for (const d of drafts) {
            const term = subtypeTerminologyFor(d.industry, d.subtype)!.primaryObject!;
            for (const language of TERMINOLOGY_LANGUAGES) {
                expect({ profile: d.profileId, language, ok: typeof term[language] === 'string' })
                    .toEqual({ profile: d.profileId, language, ok: true });
            }
        }
    });

    it('lo declarado a mano gana sobre lo derivado', () => {
        // Los perfiles que ya eligieron sus palabras las conservan: derivar no
        // puede pisar una decisión que alguien tomó mirando el rubro.
        expect(subtypeTerminologyFor('turismo', 'hotel')?.primaryObject?.es)
            .not.toBe(subtypeTerminologyFor('turismo', 'tours')?.primaryObject?.es);
    });

    it('un objeto primario que no sabemos nombrar deja el hueco visible', () => {
        // Inventar un sustantivo genérico taparía el hueco en vez de cerrarlo,
        // y el contrato dejaría de reportarlo.
        expect(NAMED_PRIMARY_OBJECTS.length).toBeGreaterThan(0);
        expect(subtypeTerminologyFor('industria_inventada', 'x')).toBeNull();
    });
});

describe('lo que queda abierto, queda abierto', () => {
    it('los huecos externos y de paquetes waitlist permanecen visibles', () => {
        const byGap: Record<string, number> = {};
        for (const gap of drafts.flatMap(domainContractGaps)) {
            byGap[gap] = (byGap[gap] ?? 0) + 1;
        }
        expect(byGap).toEqual({
            // Necesita una corrida contra un tenant real de cada perfil.
            'certification.e2e_evidence': 81,
            // Cuatro legacy y ocho destinos/perfiles waitlist.
            'certification.commercialisable': 12,
            // Destinos que en Fase 1 tienen identidad, pero aún no objetos/tools.
            'scope_without_committing_intent': 6,
        });
    });

    it('ningún perfil se declara certificado sin evidencia E2E', () => {
        // Marcarlo certificado sin esto es exactamente lo que el encargo
        // prohíbe, y nadie lo puede satisfacer desde el código.
        expect(drafts.filter(d => d.status === 'certified')).toEqual([]);
    });
});
