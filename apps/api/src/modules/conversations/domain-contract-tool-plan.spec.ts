import {
    CORE_TOOL_PREREQUISITES,
    HEALTH_INDUSTRIES,
    IDENTITY_STEP_UP_TOOL_NAMES,
    NAMED_PRIMARY_OBJECTS,
    OPERATIONS_WITHOUT_READS,
    READ_TOOL_CONTRACTS,
    TERMINOLOGY_LANGUAGES,
    assuranceLevelSatisfies,
    domainContractGaps,
    getOperation,
    getOperationCatalogue,
    listDomainContractDrafts,
    operationSafetyClassFor,
    operationsForPublishedTools,
    resolveVerticalCapabilityManifest,
    subtypeTerminologyFor,
    type IntentContract,
    type OperationDefinition,
    type ToolDefinition,
} from '@parallext/shared';
import { getToolPolicy, isBusinessWriteTool, isRegisteredStaticTool } from './tool-policy-registry';
import { TOOL_FAMILIES } from './agent-tool-registry';
import { identityStepUpToolNames } from './identity-step-up-registration';
import { commitmentFamilyForTool } from './commitment-families';
import { CORE_PREREQUISITES } from './tool-task-dependencies';
import { PAYMENT_CREATE_TOOLS, PAYMENT_STATUS_TOOLS } from './tools/payment-tools';

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
            'certification.e2e_evidence': 85,
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

/**
 * ═══ EL CATÁLOGO DE OPERACIONES (PR4) ═══
 *
 * Una pregunta de precio contestada sin leer el catálogo (QA 8e7c45b1: la
 * inmobiliaria, el hotel, el restaurante) no se arregla con otro regex: se
 * arregla declarando qué lee cada operación. Esta suite hace que un hueco en
 * esa declaración rompa CI en vez de llegar a producción: una operación sin
 * roles, sin lecturas, sin fuente para lo que afirma, una lectura que la
 * vertical no publica, o una operación de salud sin clase de seguridad.
 */
describe('el catálogo de operaciones no tiene huecos', () => {
    const operations = getOperationCatalogue();
    const definitions = new Map<string, ToolDefinition>();
    for (const family of TOOL_FAMILIES) for (const tool of family.tools) definitions.set(String(tool.name), tool);
    // Payments are registered against provider health, outside the static families.
    for (const tool of [...PAYMENT_STATUS_TOOLS, ...PAYMENT_CREATE_TOOLS]) definitions.set(String(tool.name), tool);
    const identityTools = new Set(identityStepUpToolNames());
    const CORE_FAMILIES = ['faqs', 'knowledge', 'policies', 'crm'];
    const publishedFor = (profileId: string): Set<string> => {
        const [industry, subtype] = profileId.split('/');
        const manifest = resolveVerticalCapabilityManifest(industry, subtype === '__none__' ? undefined : subtype);
        const groups = new Set<string>([...manifest.toolGroups, ...CORE_FAMILIES]);
        return new Set(TOOL_FAMILIES.filter(f => groups.has(String(f.key))).flatMap(f => f.tools.map(t => String(t.name))));
    };
    const rolesOf = (op: OperationDefinition): string[] => {
        const roles = new Set<string>();
        let wrote = false;
        for (const tool of op.visibleTools) {
            if (identityTools.has(tool)) roles.add('identity');
            else if (isBusinessWriteTool(tool)) { roles.add('write'); wrote = true; }
            else if (getToolPolicy(tool)) roles.add(wrote ? 'post_read' : 'read');
        }
        for (const r of op.requiredReads) if (!isBusinessWriteTool(r.tool)) roles.add('read');
        return [...roles];
    };

    it('cubre toda intención del contrato de dominio', () => {
        const intents = new Set(allIntents.map(i => i.key));
        const keys = new Set(operations.map(op => op.key));
        expect([...intents].filter(k => !keys.has(k))).toEqual([]);
        expect(keys.size).toBe(operations.length);
    });

    it('declara las operaciones de lectura que el QA encontró sin leer', () => {
        const reads = (key: string) => getOperation(key)?.requiredReads.map(r => r.tool);
        expect(reads('product_info')).toEqual(['search_products', 'get_product']);
        expect(reads('menu_info')).toEqual(['get_menu']);
        expect(reads('check_my_orders')).toEqual(['list_my_orders']);
        expect(reads('track_food_order')).toEqual(['list_my_orders', 'check_order_status']);
        expect(reads('property_info')).toEqual(['list_properties', 'get_property_details']);
        expect(reads('listing_info')).toEqual(['search_listings', 'get_listing_details']);
        expect(reads('view_my_appointments')).toEqual(['list_customer_appointments']);
        expect(reads('package_availability')).toEqual(['search_packages', 'check_package_availability']);
        for (const key of ['product_info', 'menu_info', 'property_info', 'listing_info', 'package_info']) {
            expect({ key, price: getOperation(key)?.factKinds.includes('price') }).toEqual({ key, price: true });
        }
        expect(getOperation('listing_info')?.factKinds).toContain('area');
        // Sin fechas, el hotel igual tiene precio: el `night_price` fijo de list_properties.
        expect(READ_TOOL_CONTRACTS.list_properties.facts).toContain('price');
        // QA: con el catálogo EN el turno (tienda, salón) el precio salió bien 4/4 sin tool;
        // sin él (inmuebles, hotel, menú, paquetes) 0/12. Toda lectura de precio de catálogo
        // declara su proyección: viva donde existe, planificada (PR5/PR7) donde no.
        const projection = (key: string) => getOperation(key)?.requiredReads.map(r => r.projection && `${r.projection.context}:${r.projection.status}`);
        expect(projection('product_info')).toEqual(['turn_catalog:live', 'turn_catalog:live']);
        expect(projection('service_info')).toEqual(['available_services:live']);
        expect(projection('menu_info')).toEqual(['turn_catalog:planned']);
        expect(projection('property_info')).toEqual(['turn_catalog:planned', 'turn_catalog:planned']);
        expect(projection('listing_info')).toEqual(['turn_catalog:planned', 'turn_catalog:planned']);
        expect(projection('package_info')).toEqual(['turn_catalog:planned', 'turn_catalog:planned']);
        // Y ninguna lectura con hechos de precio de un catálogo público queda sin camino determinista.
        const unprojected = Object.entries(READ_TOOL_CONTRACTS)
            .filter(([, c]) => c.assurance === 'A0' && c.facts.includes('price') && !c.projection)
            .map(([tool]) => tool);
        expect(unprojected.sort()).toEqual([
            'calculate_quote', 'check_package_availability', 'check_property_availability', 'check_vehicle_rental_availability',
            'get_courses', 'get_insurance_plans', 'get_promotions', 'get_vehicle_details', 'list_pet_services',
            'list_photo_packages', 'search_vehicles',
        ].filter(t => READ_TOOL_CONTRACTS[t]).sort());
    });

    it('toda operación tiene roles y lecturas (o una exención con motivo)', () => {
        const offenders: string[] = [];
        for (const op of operations) {
            const roles = rolesOf(op);
            if (!roles.length) offenders.push(`${op.key}:no_roles`);
            if (op.commits && !roles.includes('write')) offenders.push(`${op.key}:commits_without_writer`);
            if (!op.requiredReads.length && !(op.key in OPERATIONS_WITHOUT_READS)) offenders.push(`${op.key}:no_reads`);
            if (op.requiredReads.length && op.key in OPERATIONS_WITHOUT_READS) offenders.push(`${op.key}:stale_waiver`);
        }
        expect(offenders).toEqual([]);
        expect(Object.keys(OPERATIONS_WITHOUT_READS).filter(k => !getOperation(k))).toEqual([]);
    });

    it('las lecturas requeridas son lecturas registradas con su contrato y su garantía', () => {
        const offenders: string[] = [];
        for (const op of operations) {
            for (const { tool } of op.requiredReads) {
                const policy = getToolPolicy(tool);
                if (!policy) { offenders.push(`${op.key}:${tool}:unregistered`); continue; }
                if (isBusinessWriteTool(tool)) offenders.push(`${op.key}:${tool}:is_a_writer`);
                if (!READ_TOOL_CONTRACTS[tool]) offenders.push(`${op.key}:${tool}:no_read_contract`);
                if (!assuranceLevelSatisfies(op.assurance, policy.assurance)) offenders.push(`${op.key}:${tool}:assurance_${op.assurance}<${policy.assurance}`);
            }
        }
        for (const [tool, contract] of Object.entries(READ_TOOL_CONTRACTS)) {
            const policy = getToolPolicy(tool);
            if (!policy) offenders.push(`contract:${tool}:unregistered`);
            else if (policy.assurance !== contract.assurance) offenders.push(`contract:${tool}:assurance_${contract.assurance}!=${policy.assurance}`);
            else if (isBusinessWriteTool(tool)) offenders.push(`contract:${tool}:is_a_writer`);
        }
        expect(offenders).toEqual([]);
    });

    it('un lector del plan no puede quedar fuera del contrato de lectura', () => {
        // Si no, la derivación lo trataría como escritor y la operación perdería su lectura.
        const offenders = allIntents.flatMap(i => i.toolPlan
            .filter(tool => !READ_TOOL_CONTRACTS[tool] && !isBusinessWriteTool(tool) && getToolPolicy(tool)?.effect === 'read')
            .map(tool => `${i.key}:${tool}`));
        expect([...new Set(offenders)]).toEqual([]);
    });

    it('cada argumento obligatorio de una lectura tiene de dónde salir', () => {
        const offenders: string[] = [];
        const GRAMMAR = /^(slot:[a-z_]+|context:[a-zA-Z_]+|receipt:[a-z_]+\.[A-Za-z_.[\]]+)$/;
        for (const [tool, contract] of Object.entries(READ_TOOL_CONTRACTS)) {
            const definition = definitions.get(tool);
            if (!definition) { offenders.push(`${tool}:no_definition`); continue; }
            const properties = Object.keys((definition.parameters as any)?.properties ?? {});
            const required: string[] = (definition.parameters as any)?.required ?? [];
            for (const key of Object.keys(contract.argsFrom)) if (!properties.includes(key)) offenders.push(`${tool}.${key}:not_a_parameter`);
            for (const key of required) if (!contract.argsFrom[key]) offenders.push(`${tool}.${key}:required_without_source`);
            for (const [key, source] of Object.entries(contract.argsFrom)) {
                for (const alternative of source.split('|')) if (!GRAMMAR.test(alternative)) offenders.push(`${tool}.${key}:bad_source:${alternative}`);
            }
        }
        for (const op of operations) {
            const reads = new Set(op.requiredReads.map(r => r.tool));
            for (const r of op.requiredReads) {
                for (const [key, source] of Object.entries(r.argsFrom)) {
                    const alternatives = source.split('|');
                    const receipts = alternatives.filter(a => a.startsWith('receipt:'));
                    // Un id que sólo puede salir de un recibo exige que esa lectura esté en la operación.
                    if (receipts.length === alternatives.length
                        && !receipts.some(a => reads.has(a.slice('receipt:'.length).split('.')[0]))) {
                        offenders.push(`${op.key}:${r.tool}.${key}:receipt_not_read`);
                    }
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('todo lo que una operación afirma tiene una lectura que lo respalda', () => {
        const offenders: string[] = [];
        for (const op of operations) {
            if (!op.factKinds.length && !(op.key in OPERATIONS_WITHOUT_READS)) offenders.push(`${op.key}:no_facts`);
            const sourced = new Set(op.requiredReads.flatMap(r => READ_TOOL_CONTRACTS[r.tool]?.facts ?? []));
            for (const fact of op.factKinds) {
                if (fact === 'commit_receipt') { if (!op.commits) offenders.push(`${op.key}:receipt_without_commit`); continue; }
                if (!sourced.has(fact)) offenders.push(`${op.key}:${fact}:no_source`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('un compromiso que mueve dinero se apoya en una lectura de precio', () => {
        const offenders: string[] = [];
        for (const op of operations.filter(o => o.commits)) {
            for (const writer of op.writers) {
                const family = commitmentFamilyForTool(writer);
                if (family?.payable && !op.factKinds.includes('price')) offenders.push(`${op.key}:${writer}:${family.family}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('las lecturas de un compromiso son exactamente sus prerrequisitos centrales', () => {
        expect(CORE_PREREQUISITES).toBe(CORE_TOOL_PREREQUISITES);
        for (const op of operations.filter(o => o.requiredReadsSource === 'core_prerequisites')) {
            const expected = [...new Set(op.writers.flatMap(w => CORE_TOOL_PREREQUISITES[w] ?? []))];
            expect({ op: op.key, reads: op.requiredReads.map(r => r.tool) }).toEqual({ op: op.key, reads: expected });
        }
    });

    it('cada lectura requerida está publicada en toda vertical que publica la operación', () => {
        const offenders = new Set<string>();
        for (const op of operations) {
            for (const profile of op.profiles) {
                const published = publishedFor(profile);
                for (const { tool } of op.requiredReads) if (!published.has(tool)) offenders.add(`${op.key}:${tool}@${profile}`);
            }
            if (!op.profiles.length) offenders.add(`${op.key}:published_nowhere`);
        }
        // Hueco real, fijado para que sólo pueda achicarse: el alquiler de vehículos
        // publica `vehicles` (y con él la prueba de manejo) pero no `appointments`,
        // así que los prerrequisitos de agenda de `schedule_test_drive` no existen ahí.
        expect([...offenders]).toEqual([
            'schedule_test_drive:list_services@automotriz/alquiler',
            'schedule_test_drive:check_availability@automotriz/alquiler',
        ]);
    });

    it('el par de verificación de identidad es el mismo en el catálogo y en el runtime', () => {
        expect([...IDENTITY_STEP_UP_TOOL_NAMES].sort()).toEqual([...identityTools].sort());
    });

    it('las tools visibles existen y son pocas', () => {
        for (const op of operations) {
            expect({ op: op.key, unknown: op.visibleTools.filter(t => !isRegisteredStaticTool(t) && !identityTools.has(t)) })
                .toEqual({ op: op.key, unknown: [] });
            expect({ op: op.key, ok: op.visibleTools.length >= 1 && op.visibleTools.length <= 8 }).toEqual({ op: op.key, ok: true });
        }
    });

    it('toda operación que publica un negocio de salud tiene clase de seguridad', () => {
        const offenders = new Set<string>();
        for (const op of operations) {
            for (const profile of op.profiles) {
                const industry = profile.split('/')[0];
                if (HEALTH_INDUSTRIES.includes(industry) && !operationSafetyClassFor(op, industry)) offenders.add(`${op.key}@${industry}`);
            }
        }
        expect([...offenders]).toEqual([]);
        expect(operationSafetyClassFor(getOperation('pet_emergency')!, 'veterinaria')).toBe('emergency');
        expect(operationSafetyClassFor(getOperation('book_appointment')!, 'salud')).toBe('red_flag_triage');
        expect(operationSafetyClassFor(getOperation('book_appointment')!, 'moda_belleza')).toBe('none');
    });

    it('el clasificador sólo elige entre operaciones que el turno publica', () => {
        const store = operationsForPublishedTools(['search_products', 'get_product', 'search_faqs']).map(op => op.key);
        expect(store).toEqual(expect.arrayContaining(['product_info', 'browse_catalog', 'ask_question']));
        expect(store).not.toContain('listing_info');
    });
});
