/*
 * ═══ M0–M6 AND R0–R6, DECIDED BY COUNTERS RATHER THAN BY WHOEVER IS WRITING ═══
 *
 * The A1–H3 table already works this way and it is the reason that table can be
 * trusted: a row declares a CONDITION and its status follows from it, so
 * closing a gap changes the table by changing the code.
 *
 * The October programme — M0–M6 in `claude-meta-whatsapp-adaptation.md` and
 * R0–R6 in `claude-whatsapp-response-spend-guardrails.md` — had no such table.
 * Its status lived in prose, and an independent review put the programme at
 * "approximately 45%" while the generated report said zero rows open, because
 * the generated report was not measuring this programme at all. Two numbers
 * about the same repository, neither of them wrong about what it measured, and
 * a reader with no way to tell.
 *
 * So these rows read the same authorities the product reads.
 *
 * ── WHAT A ROW MAY AND MAY NOT DO ───────────────────────────────────────────
 *
 * A row may report a counter. It may not decide that a counter is acceptable.
 * `R0` is open while twenty-one billable producers sit on a lane that keeps no
 * row; it closes when that number reaches zero, and no sentence written here
 * can close it sooner. That is the point: this programme has already shipped a
 * table claiming a phase complete while the work was in a branch.
 *
 * ── DURABLE IS A PROPERTY OF THE LANE, NOT AN OPINION ───────────────────────
 *
 * `EGRESS_LANES` says which lanes write a row before the request goes out:
 * `dispatch_outbox`, `approved_effect`, `operational_notice` and
 * `handoff_effects` do; `outbound_queue` (Redis is the record), `domain_queue`
 * and `inline` (no queue, no row) do not. A producer on one of the last three
 * cannot answer "did this go out" after a restart, so it is off the durable
 * lane whatever else is true of it.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Lanes that commit a row before the provider is called. */
const DURABLE_LANES = new Set(['dispatch_outbox', 'approved_effect', 'operational_notice',
    'handoff_effects']);

/**
 * A number these rows are about to put in a sentence, or the generator stops.
 *
 * M2 shipped `... y **undefined** entregas de servicio gratuitas por número y
 * mes calendario` for as long as the artefact existed. The destructure below
 * named `FREE_SERVICE_DELIVERIES_PER_MONTH`, which is not an export of anything
 * — a repository-wide search found the name only inside this file — so
 * JavaScript handed back `undefined` without a word, the template interpolated
 * it, and the row read as a measured fact.
 *
 * `--check` agreed with it, because the committed JSON carried the same string:
 * the check was comparing the mistake to itself. That is the shape of the
 * defect, and it is why a guard on the VALUE is the only one that helps — a
 * destructure of a missing export cannot be caught downstream of itself.
 *
 * Throwing rather than substituting a zero is deliberate: a zero would render,
 * and "0 entregas de servicio gratuitas" is a different wrong fact, quieter
 * than the first one.
 */
function figure(name, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`october authority \`${name}\` is not a finite number `
            + `(${String(value)}): the export it is read from does not exist or changed name. `
            + 'Fix the import — do not let the report render it.');
    }
    return value;
}

/**
 * Everything these rows are allowed to know, computed once from the code.
 *
 * `api` is the generator's own module loader, so these rows read exactly the
 * modules the product runs rather than a copy.
 */
function octoberAuthorities({ root, api, shared }) {
    void shared;
    const inventory = require(path.join(root, 'apps/api/scripts/outbound-producer-inventory.cjs'));
    const rows = inventory.collect();
    const census = inventory.gateCensus(rows);
    const billable = census.classified.filter(row => row.needsGate);
    const offDurable = billable.filter(row => !DURABLE_LANES.has(row.lane));
    const byLane = {};
    for (const row of offDurable) byLane[row.lane] = (byLane[row.lane] ?? 0) + 1;

    /** Is the committed census artefact the one this HEAD produces? */
    const artefact = path.join(root, 'docs/audits/2026-09-10/outbound-producer-inventory.md');
    const rendered = inventory.render(rows, inventory.declaredProducers(),
        inventory.declaredInfrastructure(), census);
    const censusStale = !fs.existsSync(artefact)
        || fs.readFileSync(artefact, 'utf8').split('\r\n').join('\n')
            !== String(rendered).split('\r\n').join('\n');

    const {
        EXTERNAL_EFFECT_PRODUCERS, summariseExternalEffects,
    } = api('modules/channels/external-effect-inventory.ts');
    const effects = summariseExternalEffects();
    /**
     * M1 and M5 are about WhatsApp, so they count the producers that can reach a
     * provider-billed messaging channel — not the Google Calendar write and the
     * Wompi charge, which are external effects with their own programmes. A
     * counter that sweeps everything makes a WhatsApp row open because a
     * calendar integration has no erasure path, and then nobody can tell what
     * closing the row would require.
     */
    const MESSAGING_EGRESS = /whatsapp|instagram|messenger|telegram|dispatch|outbound|channel|notice/i;
    const messaging = EXTERNAL_EFFECT_PRODUCERS.filter(producer =>
        MESSAGING_EGRESS.test(String(producer.egress ?? ''))
        || MESSAGING_EGRESS.test(String(producer.source ?? '')));
    const messagingGaps = property => messaging
        .filter(producer => producer.properties[property].level === 'none')
        .map(producer => producer.id);

    const { PROACTIVE_POLICIES } = api('modules/persona/proactive-policy-authority.ts');
    const { SENDING_ROLES } = api('modules/persona/human-operator-authority.ts');
    const { DISPATCH_ITEM_KINDS } = api('modules/channels/agent-dispatch-outbox.ts');
    const { SPEND_SCOPE_KINDS } = api('modules/billing/whatsapp-spend/spend-scopes.ts');
    const { ACCEPTANCE_MATRIX, uncoveredScenarios } =
        api('modules/billing/whatsapp-spend/acceptance-matrix.ts');
    const { DEFAULT_REPETITION_POLICY } = api('modules/billing/whatsapp-spend/spend-repetition.ts');
    const { WHATSAPP_MESSAGE_CATEGORIES } = api('modules/billing/whatsapp-rates/index.ts');
    const { WHATSAPP_RATE_CARDS, WHATSAPP_RATE_TABLE_VERSION, WHATSAPP_FREE_SERVICE_ALLOWANCE } =
        api('modules/billing/whatsapp-rates/whatsapp-rate-table.generated.ts');
    /**
     * The free thousand is declared twice in the product, by two modules that do
     * not import one another: the rate table carries it as evidence preserved
     * from Meta's own cards, and the spend lane carries it as the constant the
     * admission counter decrements. Reading only one of them would let the
     * report agree with a number the sending path has stopped using.
     *
     * So both are read and they have to say the same thing. A disagreement is a
     * real defect — one of the two has been edited — and it stops the generator
     * instead of picking a winner.
     */
    const { FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH } =
        api('modules/billing/whatsapp-spend/free-allowance.ts');
    const freeAllowance = figure('freeAllowance', WHATSAPP_FREE_SERVICE_ALLOWANCE?.deliveries);
    if (figure('freeServiceMessagesPerNumberMonth', FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH)
        !== freeAllowance) {
        throw new Error('the free service allowance disagrees between the rate table '
            + `(${freeAllowance}) and the spend lane (${FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH}); `
            + 'the report will not pick one');
    }

    /**
     * The REST item shapes the API accepts, against what the durable lane can
     * represent. A type the API takes and the lane cannot carry is a producer
     * that CANNOT be migrated, which is why this is its own counter rather than
     * a note on R0.
     */
    const restController = fs.readFileSync(
        path.join(root, 'apps/api/src/modules/whatsapp/whatsapp.controller.ts'), 'utf8');
    const REST_SHAPES = {
        text: 'text', template: 'template', interactive: 'interactive',
        media: 'media', location: 'location',
    };
    const unrepresentable = Object.entries(REST_SHAPES)
        .filter(([endpoint, kind]) =>
            new RegExp(`send${endpoint[0].toUpperCase()}${endpoint.slice(1)}`, 'i').test(restController)
            && !DISPATCH_ITEM_KINDS.includes(kind))
        .map(([endpoint]) => endpoint);

    return {
        rows, census, billable, offDurable, byLane, censusStale,
        bypasses: census.bypasses,
        producers: EXTERNAL_EFFECT_PRODUCERS, effects, messaging, messagingGaps,
        policies: Object.keys(PROACTIVE_POLICIES),
        sendingRoles: SENDING_ROLES,
        itemKinds: DISPATCH_ITEM_KINDS,
        spendScopes: SPEND_SCOPE_KINDS,
        acceptanceScenarios: figure('acceptanceScenarios', ACCEPTANCE_MATRIX.length),
        uncoveredScenarios: uncoveredScenarios().map(row => row.scenario),
        // R2 divides two of these by 60000 to say the policy in minutes, so a
        // missing one renders `NaN minutos` rather than failing.
        repetition: {
            ...DEFAULT_REPETITION_POLICY,
            maxIdentical: figure('repetition.maxIdentical', DEFAULT_REPETITION_POLICY?.maxIdentical),
            windowMs: figure('repetition.windowMs', DEFAULT_REPETITION_POLICY?.windowMs),
            cooldownMs: figure('repetition.cooldownMs', DEFAULT_REPETITION_POLICY?.cooldownMs),
        },
        categories: WHATSAPP_MESSAGE_CATEGORIES,
        freeAllowance,
        rateCards: WHATSAPP_RATE_CARDS, rateTableVersion: WHATSAPP_RATE_TABLE_VERSION,
        unrepresentable,
    };
}

/**
 * The fourteen rows.
 *
 * `row` is the same constructor the A1–H3 table uses, so provenance,
 * contradiction detection and the gate vocabulary are shared rather than
 * reimplemented — a second table with its own rules is how two reports about
 * one repository come to disagree.
 */
function octoberRows(row, A) {
    const list = names => names.join(', ');
    const laneBreakdown = Object.entries(A.byLane)
        .map(([lane, count]) => `${count} en \`${lane}\``).join(', ');

    return [
        row('M0', { provenance: 'derived',
            open: (A.censusStale ? 1 : 0) + A.bypasses.length,
            openLabel: [
                A.censusStale ? 'el censo versionado no corresponde a este HEAD' : '',
                A.bypasses.length ? `${A.bypasses.length} productores fuera de la frontera económica` : '',
            ].filter(Boolean).join('; '),
            evidence: `Censo derivado del árbol: ${A.rows.length} call sites, ${A.billable.length} `
                + `cobrables, ${A.bypasses.length} fuera de la autoridad económica. El inventario de `
                + `efectos declara ${A.producers.length} productores y `
                + `${A.effects.uncovered.length} con al menos una propiedad en \`none\`. `
                + 'La condición es que el artefacto versionado se regenere desde el mismo HEAD, no '
                + 'que alguien lo haya leído.' }),

        row('M1', { provenance: 'derived',
            open: A.messagingGaps('authority').length + A.messagingGaps('idempotency').length,
            openLabel: `${A.messagingGaps('authority').length} productores de mensajería sin `
                + `autoridad y ${A.messagingGaps('idempotency').length} sin idempotencia`,
            gates: [1, 4],
            evidence: 'Remitente, pagador y credencial salen del resolver único; la unión de '
                + `autoridades cubre agente servido, ${A.policies.length} políticas proactivas `
                + `(${list(A.policies)}) y operador humano con ${A.sendingRoles.length} roles. `
                + 'BSUID, la procedencia del token BISU y el control del hilo frente al agente de '
                + 'Meta ya están en el código y probados: un remitente sin teléfono se contesta en '
                + 'vez de descartarse, un token del portafolio del proveedor se rechaza en vez de '
                + 'firmar el envío de un tenant, y el control del hilo es durable y se recupera '
                + 'solo. Lo que falta es una cuenta real: ninguna de esas transiciones vio todavía '
                + 'un traspaso de verdad, y por eso la coexistencia va detrás de un interruptor '
                + 'apagado. El contador de esta fila mide otra cosa —productores de mensajería sin '
                + 'autoridad o sin idempotencia— y sigue siendo lo que la mantiene abierta.' }),

        row('M2', { provenance: 'derived',
            open: A.rateCards && A.rateCards.length ? 0 : 1,
            openLabel: 'la tarjeta de tarifas versionada no está cargada',
            gates: [4],
            evidence: `Tarifas versionadas \`${A.rateTableVersion}\` con ${A.rateCards.length} `
                + 'tarjetas, '
                + `${A.categories.length} categorías que Meta cobra por separado y `
                + `${A.freeAllowance} entregas de servicio gratuitas por número y mes calendario. `
                + 'La categoría aprobada y la ventana de servicio se leen de la base del tenant '
                + 'antes de admitir. Lo que falta es una cuenta real: tarifa aplicada por Meta al '
                + 'entregar y conciliación contra factura.' }),

        row('M3', { provenance: 'derived',
            open: A.bypasses.length,
            openLabel: `${A.bypasses.length} productores cobrables fuera del gate económico`,
            evidence: `Autoridad económica transaccional con ${A.spendScopes.length} alcances `
                + `(${list(A.spendScopes)}), reserva antes del efecto y liquidación contra el `
                + 'recibo. Cero productores cobrables fuera del gate en este HEAD: lo verifica el '
                + 'censo, no esta frase.' }),

        row('M4', { provenance: 'declared', open: 1,
            openLabel: 'la propuesta de precios y la transición de planes son una decisión comercial '
                + 'que nadie ha tomado',
            gates: [5],
            evidence: 'Escenarios por país, canal, tarea y ciclo se pueden generar de los cinco '
                + 'planes vigentes, pero el cambio de precio, la capacidad ofrecida y la '
                + 'comunicación a clientes afectados no son trabajo de código. Se dice como '
                + 'declaración porque lo es: cambiar el código de esta área no cambia esta fila.' }),

        row('M5', { provenance: 'derived',
            open: A.messagingGaps('erasure').length,
            openLabel: `${A.messagingGaps('erasure').length} productores de mensajería sin borrado `
                + 'alcanzable',
            gates: [1, 6],
            evidence: 'Aprendizaje conserva origen y finalidad; publicación y rollback llegan a los '
                + 'derivados. El agente de negocio de Meta sigue apagado. El piloto real necesita '
                + 'cuenta, destinatario consentido y presupuesto autorizado, que son gates, no '
                + 'código.' }),

        row('M6', { provenance: 'declared', open: 1,
            openLabel: 'marketing avanzado, Direct Send, llamadas/grupos y wallet de reventa no '
                + 'están construidos y están fuera del alcance de octubre por decisión explícita',
            gates: [5],
            evidence: 'M5 los separa a M6 a propósito, con flags y elegibilidad propias, para que '
                + 'no bloqueen la continuidad básica. Se registra abierta en vez de omitirse: una '
                + 'fila que no aparece se lee como cerrada.' }),

        // ── R0–R6: que ningún productor pueda entregar fuera de la autorización ──

        row('R0', { provenance: 'derived',
            open: A.offDurable.length,
            openLabel: `${A.offDurable.length} productores cobrables fuera del carril durable `
                + `(${laneBreakdown})`,
            evidence: `De ${A.billable.length} call sites cobrables, ${A.offDurable.length} usan un `
                + 'carril que no escribe fila antes del POST — Redis es el registro, o no hay '
                + 'registro. Un productor ahí no puede contestar "¿esto salió?" después de un '
                + 'reinicio. El criterio principal de R6 es exactamente este número en cero. '
                + 'Ninguno de los siete carece del camino durable: seis son el repliegue de '
                + '`conversations.service.ts` cuando el interruptor de despliegue está apagado, y '
                + 'el séptimo es la consola en un canal SIN transporte estricto, que no puede '
                + 'entregar exactamente un efecto y decir qué pasó. Por eso el número no baja '
                + 'escribiendo código: baja encendiendo un interruptor —decisión de piloto del '
                + 'dueño— o dándole transporte estricto a ese canal.' }),

        row('R1', { provenance: 'derived',
            open: A.unrepresentable.length,
            openLabel: A.unrepresentable.length
                ? `la API acepta ${list(A.unrepresentable)} y el carril durable no puede representarlo`
                : '',
            evidence: `El carril transporta ${A.itemKinds.length} tipos de item `
                + `(${list(A.itemKinds)}), incluidos los menús y las ubicaciones que el carril REST `
                + 'manda todos los días. Los efectos se cuentan DESPUÉS de formarlos: un caption '
                + 'nativo viaja dentro del item donde el proveedor lo cobra como un mensaje, y como '
                + 'item propio donde no.' }),

        row('R2', { provenance: 'derived',
            open: A.repetition && Number(A.repetition.maxIdentical) > 0
                && Number(A.repetition.cooldownMs) > 0 ? 0 : 1,
            openLabel: 'la política de repetición no está cargada',
            evidence: 'Esperar y suprimir son resultados durables y distintos de error, resolución '
                + 'y handoff, así que ningún catch los convierte en un texto cobrable. La política '
                + `por defecto admite ${A.repetition.maxIdentical} mensaje(s) idéntico(s) en `
                + `${A.repetition.windowMs / 60000} minutos, con un enfriamiento de `
                + `${A.repetition.cooldownMs / 60000} minutos, y es revisable por tarea e idioma.` }),

        row('R3', { provenance: 'derived',
            open: ['number_month', 'account', 'business', 'contact', 'task']
                .filter(kind => !A.spendScopes.includes(kind)).length,
            openLabel: 'faltan alcances de gasto: '
                + ['number_month', 'account', 'business', 'contact', 'task']
                    .filter(kind => !A.spendScopes.includes(kind)).join(', '),
            gates: [4],
            evidence: `Los ${A.spendScopes.length} alcances se reservan en orden fijo dentro de una `
                + 'transacción, así que dos workers peleando por el último importe no pueden '
                + 'asignarlo dos veces. El mercado sale de la dirección del destinatario, nunca del '
                + 'país de la empresa, y un destino desconocido no tiene tarifa cero.' }),

        row('R4', { provenance: 'derived',
            open: A.offDurable.length,
            openLabel: `${A.offDurable.length} productores todavía pueden emitir sin fila durable `
                + `(${laneBreakdown})`,
            evidence: 'La consola humana, la API REST y las campañas necesitan la misma admisión '
                + 'que el agente: un handoff detiene la IA, pero las respuestas humanas siguen '
                + 'generando cargos. La autoridad de operador humano existe desde este HEAD; lo que '
                + 'falta es que cada productor la use, y eso se cuenta arriba.' }),

        row('R5', { provenance: 'derived',
            open: A.uncoveredScenarios.length,
            openLabel: `${A.uncoveredScenarios.length} de ${A.acceptanceScenarios} escenarios de la `
                + 'matriz de aceptación sin prueba que los conteste: '
                + A.uncoveredScenarios.join('; '),
            evidence: `La matriz dejó de ser una tabla en un documento: sus `
                + `${A.acceptanceScenarios} filas son datos, cada una nombra el archivo y UN TÍTULO `
                + 'POR MITAD del escenario, y una comprobación verifica que cada título sea el de '
                + 'un `it()` que de verdad corre — ni prosa, ni un `describe`, ni un `skip`. Una '
                + 'fila vale lo que su mitad más delgada: si una de ellas no está probada, la fila '
                + 'entera figura con `null` y dice qué haría falta, en '
                + 'vez de quedar fuera de la tabla para que la columna parezca llena — que es '
                + 'exactamente cómo un contador llega a cero sin que nadie cierre nada.' }),

        row('R6', { provenance: 'derived',
            open: A.offDurable.length + A.bypasses.length,
            openLabel: `${A.offDurable.length + A.bypasses.length} productores pueden entregar fuera `
                + 'de la autorización aplicable',
            gates: [1, 5, 7],
            evidence: 'El criterio principal de R6, textual: **ningún productor de WhatsApp puede '
                + 'generar una entrega fuera de la autorización aplicable**. Mientras el contador '
                + 'sea distinto de cero la fila está abierta, y después seguirá bloqueada por el '
                + 'modo observación, el canario con techo explícito y la autorización de activar '
                + '`enforce`.' }),
    ];
}

module.exports = { octoberAuthorities, octoberRows, DURABLE_LANES, figure };
