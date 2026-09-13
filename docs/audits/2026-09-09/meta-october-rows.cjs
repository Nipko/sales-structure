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
    'handoff_effects', 'delivery_outbox']);

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
        EXTERNAL_EFFECT_PRODUCERS, summariseExternalEffects, isMetaBillableCustomerMessage,
        metaBillsDelivery, EFFECT_CLASSES,
    } = api('modules/channels/external-effect-inventory.ts');
    const effects = summariseExternalEffects();
    /**
     * ═══ WHICH PRODUCERS M1 AND M5 ARE ACTUALLY ABOUT ═══
     *
     * These two rows are about WhatsApp: what Meta can bill the tenant's WABA
     * for, and what a right-to-erasure request has to reach in those messages.
     *
     * They used to choose their producers with a regular expression over the
     * `source` and `egress` STRINGS — which is a question about spelling. It
     * swept in twenty-seven producers and nine of them were not messages to a
     * customer at all: internal platform alerts, coupon alerts, the email
     * channel's inbound reply, the retired conversational SMS adapter,
     * connecting and testing a channel, creating a WhatsApp template, writing
     * the business profile, and rotating a token. A WhatsApp row could open
     * because a token rotation has no erasure path, and closing it would have
     * meant work on something the row was never about.
     *
     * The inventory now declares a `reach` for every producer, and the
     * selection is that contract: a message to the tenant's CUSTOMER that can
     * leave over WhatsApp. `metaBillsDelivery` is derived from the channel
     * list, so it cannot drift from it.
     */
    const messaging = EXTERNAL_EFFECT_PRODUCERS.filter(isMetaBillableCustomerMessage);
    /**
     * A gap is `none` or `partial`, and `not_applicable` is NEITHER.
     *
     * `none` used to answer two opposite questions — "personal data with nothing
     * erasing it" and "this operation holds no contact data" — and they were
     * being summed. The inventory separates them now; this is the reading half.
     */
    const messagingGaps = property => messaging
        .filter(producer => {
            const level = producer.properties[property].level;
            return level === 'none' || level === 'partial';
        })
        .map(producer => producer.id);

    /**
     * Everything the regex used to sweep in, kept in view rather than dropped.
     *
     * Narrowing a counter is only honest if what leaves it lands somewhere. Each
     * class keeps its own gap list here, so a reader can see that an operator
     * notification with no erasure path did not stop being a fact — it stopped
     * being a WhatsApp fact.
     */
    const byClass = {};
    for (const cls of EFFECT_CLASSES) {
        const members = EXTERNAL_EFFECT_PRODUCERS.filter(producer => producer.reach.class === cls);
        byClass[cls] = {
            total: members.length,
            metaBillable: members.filter(producer => metaBillsDelivery(producer.reach)).length,
            gaps: Object.fromEntries(['authority', 'idempotency', 'receipt', 'uncertainOutcome',
                'erasure', 'recovery'].map(property => [property, members.filter(producer => {
                const level = producer.properties[property].level;
                return level === 'none' || level === 'partial';
            }).map(producer => producer.id)])),
        };
    }

    const { PROACTIVE_POLICIES } = api('modules/persona/proactive-policy-authority.ts');
    const { SENDING_ROLES } = api('modules/persona/human-operator-authority.ts');
    const { DISPATCH_ITEM_KINDS } = api('modules/channels/agent-dispatch-outbox.ts');
    const { SPEND_SCOPE_KINDS } = api('modules/billing/whatsapp-spend/spend-scopes.ts');
    const { WHATSAPP_OCTOBER_COMMERCIAL_POLICY } =
        api('modules/billing/whatsapp-spend/whatsapp-commercial-policy.ts');
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
        producers: EXTERNAL_EFFECT_PRODUCERS, effects, messaging, messagingGaps, byClass,
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
        commercialPolicy: WHATSAPP_OCTOBER_COMMERCIAL_POLICY,
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
            openLabel: `${A.messagingGaps('authority').length} productores de mensaje al cliente `
                + `cobrables por Meta sin autoridad y ${A.messagingGaps('idempotency').length} sin `
                + `idempotencia, sobre ${A.messaging.length} productores de esa clase`,
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

        row('M4', { provenance: 'declared',
            open: [
                A.commercialPolicy?.decisionId,
                A.commercialPolicy?.owner,
                A.commercialPolicy?.decidedAt,
                A.commercialPolicy?.pricing?.planPricesChange === false,
                A.commercialPolicy?.defaults?.enforcement === 'observe',
                Number(A.commercialPolicy?.defaults?.numberDeliveriesPerCalendarMonth) > 0,
                Number(A.commercialPolicy?.defaults?.contactDeliveriesPerCalendarMonth) > 0,
                A.commercialPolicy?.communication?.lowRateMessage,
                A.commercialPolicy?.communication?.highRateMessage,
                A.commercialPolicy?.communication?.startsOn,
            ].filter(value => !value).length,
            openLabel: 'faltan campos de la decisión comercial ejecutable de octubre',
            gates: [5],
            evidence: 'La decisión de producto está aplicada por la autoridad '
                + '`WHATSAPP_OCTOBER_COMMERCIAL_POLICY`: precios y capacidad de los cinco planes '
                + 'sin cambio; techo observable por número de '
                + `${A.commercialPolicy.defaults.numberDeliveriesPerCalendarMonth} entregas/mes y por contacto de `
                + `${A.commercialPolicy.defaults.contactDeliveriesPerCalendarMonth}; aviso desde `
                + `${A.commercialPolicy.communication.startsOn} y fecha límite `
                + `${A.commercialPolicy.communication.paymentMethodDeadline}. El ledger importa esa misma `
                + 'autoridad al crear contadores, por lo que el reporte no puede separarse del runtime. '
                + 'El análisis que sustenta la decisión queda en '
                + '`docs/audits/2026-09-12/m4-pricing-proposal.md`: tarifas de servicio y '
                + 'marketing de seis mercados derivadas de la tarjeta de octubre, los cinco '
                + 'planes vigentes, el gasto real del cliente en dos extremos geográficos, un '
                + 'escenario elegido y cuatro alternativas descartadas. Falta publicar la versión '
                + 'desplegada, que pertenece al gate de release.' }),

        row('M5', { provenance: 'derived',
            open: A.messagingGaps('erasure').length,
            openLabel: `${A.messagingGaps('erasure').length} productores de mensaje al cliente `
                + `cobrables por Meta sin borrado alcanzable, sobre ${A.messaging.length} de esa clase`,
            gates: [1, 6],
            evidence: 'Aprendizaje conserva origen y finalidad; publicación y rollback llegan a los '
                + 'derivados. El agente de negocio de Meta sigue apagado. El piloto real necesita '
                + 'cuenta, destinatario consentido y presupuesto autorizado, que son gates, no '
                + 'código.' }),

        row('M6', { provenance: 'declared', open: 0,
            openLabel: 'marketing avanzado, Direct Send, llamadas/grupos y wallet de reventa no '
                + 'están construidos y quedan fuera del alcance de octubre por decisión '
                + 'explícita; no bloquean este release',
            gates: [],
            deferral: {
                decision: 'Fuera del alcance de octubre. No se construye marketing avanzado, '
                    + 'Direct Send, llamadas/grupos ni wallet de reventa para este release; M5 '
                    + 'los separó a propósito, con flags y elegibilidad propias, para que la '
                    + 'continuidad básica no dependa de ellos.',
                owner: 'dueño del producto (la decisión de alcance es comercial, no técnica)',
                reopenWhen: 'se autorice el alcance para un release posterior, o Meta cambie la '
                    + 'elegibilidad de alguna de esas superficies de modo que la continuidad '
                    + 'básica dependa de una de ellas. Reabrir significa volver a `abierta` con '
                    + 'trabajo local, no declararla aceptada.',
            },
            evidence: 'Se registra DIFERIDA y no abierta: mantener abierto un release por '
                + 'alcance que alguien quitó a propósito es tenerlo abierto para siempre. Y no '
                + 'aceptada: nada de esto está construido, y una fila aceptada sobre '
                + 'funcionalidad inexistente es la única lectura peor. Tampoco se omite: esta '
                + 'tabla ya aprendió que una fila que no se imprime se lee como cerrada.' }),

        // ── R0–R6: que ningún productor pueda entregar fuera de la autorización ──

        row('R0', { provenance: 'derived',
            open: A.offDurable.length,
            openLabel: `${A.offDurable.length} productores cobrables fuera del carril durable `
                + `(${laneBreakdown})`,
            evidence: `De ${A.billable.length} call sites cobrables, ${A.offDurable.length} usan un `
                + 'carril que no escribe fila antes del POST — Redis es el registro, o no hay '
                + 'registro. Un productor ahí no puede contestar "¿esto salió?" después de un '
                + 'reinicio. **Este número no es el criterio de R6**, que pregunta por la '
                + 'autorización aplicable y la mide con los productores fuera del gate '
                + 'económico. Lo que esta fila mide es la fila durable antes del POST; desde este '
                + 'HEAD todo productor cobrable la crea y ningún interruptor puede devolverlo al '
                + 'carril anterior.' }),

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
                + 'generando cargos. Desde este HEAD cada productor usa una fila durable y la '
                + 'autoridad correspondiente; cualquier ruta nueva vuelve a abrir este contador.' }),

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

        /**
         * ═══ THE COUNTER THIS ROW IS NAMED AFTER ═══
         *
         * It was `offDurable + bypasses`, under the headline "can deliver
         * outside the applicable authorisation". Those are two different
         * properties and only the second one is this row's question.
         *
         * The applicable authorisation is the transactional money authority:
         * settled spend plus committed reservations plus pending exposure may
         * not exceed it, reserved BEFORE the effect. `bypasses` counts the
         * chargeable producers that reach a POST without passing it, and the
         * legacy BullMQ lane DOES pass it — `gateOrSuppress` at the last lane
         * in `outbound-queue.processor.ts`, which is why the census reads zero
         * there. That reading is not a claim: the census suite deletes the
         * gate from the real sink through a source overlay and every producer
         * behind it turns into a violation in the same run.
         *
         * Being off the DURABLE lane is the other property: no row before the
         * POST, so "did this go out?" has no answer after a restart, and no
         * receipt, uncertain outcome, recovery or reachable erasure. Real, and
         * counted — by R0 and R4, which stay open on exactly that number.
         * Adding it here made this row report a lane membership as an
         * authorisation failure, and M3 already measures the authorisation.
         *
         * Correcting it does NOT accept the row: with the local condition met
         * it is blocked by observe mode, by the canary with an explicit
         * ceiling, and by the authorisation to switch `enforce` on.
         */
        row('R6', { provenance: 'derived',
            open: A.bypasses.length,
            openLabel: `${A.bypasses.length} productores de WhatsApp pueden entregar fuera `
                + 'de la autorización aplicable',
            gates: [1, 5, 7],
            evidence: 'El criterio principal de R6, textual: **ningún productor de WhatsApp puede '
                + 'generar una entrega fuera de la autorización aplicable**. Esa autorización es la '
                + 'autoridad económica transaccional, y el censo derivado del árbol cuenta '
                + `${A.bypasses.length} productores cobrables que llegan a un POST sin pasarla. `
                + 'Lo verifica una mutación '
                + 'que borra el gate del sink real, no esta frase. **Este contador sumó hasta '
                + `este HEAD los ${A.offDurable.length} productores fuera del carril durable `
                + `(${laneBreakdown}), que es otra propiedad**: no hay fila antes del POST, así `
                + 'que nadie puede contestar "¿esto salió?" tras un reinicio. Esa propiedad se '
                + 'mide en R0 y R4 y también está en cero. Con la condición local cumplida '
                + 'esta fila queda bloqueada por el modo observación, el canario con techo '
                + 'explícito y la autorización de activar `enforce`.' }),
    ];
}

module.exports = { octoberAuthorities, octoberRows, DURABLE_LANES, figure };
