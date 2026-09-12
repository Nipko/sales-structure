/**
 * ═══ THE EIGHTEEN SCENARIOS, AND WHICH TEST ANSWERS EACH ONE ═══
 *
 * `claude-whatsapp-response-spend-guardrails.md` §R5 prints an acceptance
 * matrix: eighteen situations, each with the evidence it has to produce. It is
 * a table in a document, so the only way to know whether a row is covered was
 * to read the suite and decide — and "somebody read it and decided" is exactly
 * the kind of claim this programme keeps finding to be wrong.
 *
 * So the mapping is data. Each scenario names the spec file and the TEST TITLES
 * that answer it, and a check asserts that the file exists and that each title
 * is a real `it()` in it. A scenario with no test says so, by name, and the
 * closure report counts it.
 *
 * ── WHY `covered: null` IS THE HONEST VALUE AND NOT AN OMISSION ─────────────
 *
 * Most of these are covered and some are not. The temptation is to leave the
 * uncovered ones out of the table, which makes the table look complete and the
 * counter read zero — the exact failure the derived closure report exists to
 * prevent. They are listed with `null`, so the number of uncovered scenarios is
 * a fact about the repository rather than about who wrote the list.
 *
 * ── AND WHY A TEST TITLE RATHER THAN A FILE ─────────────────────────────────
 *
 * Naming only the file would let a scenario be "covered" by a suite that
 * happens to live in the right place. The title has to be a test that RUNS, so
 * deleting or renaming the test that actually answers the scenario breaks the
 * mapping instead of silently keeping it green.
 *
 * That promise was written here before it was true. The check behind it looked
 * for the fragment anywhere in the file's text, and three rows were being held
 * up by text that runs nothing:
 *
 *   · `999` for the allowance boundary appeared only in a header comment and in
 *     an aside — `October's unused 999 do not follow it.` Deleting all twelve
 *     `it()` blocks of that file left the row green, which is strictly weaker
 *     than naming the file.
 *   · `nurturing` matched the `import { NurturingService }` line.
 *   · `flow` matched a mock payload, and reached a title only through `flowId`.
 *
 * So a fragment now has to (1) appear inside an actual `it()` / `test()` title,
 * (2) match exactly ONE title in that file — a fragment matching two titles
 * survives the deletion of either, which is the promise above with the teeth
 * pulled out — and (3) be long enough that a word as common as `flow` cannot be
 * it. A row whose scenario has several halves names a title for each, because
 * a row is only as covered as its thinnest half.
 */

export interface AcceptanceScenario {
    /** The row as the handoff states it. */
    readonly scenario: string;
    /** The evidence the handoff says it must produce. */
    readonly evidence: string;
    /**
     * Where that evidence is produced, or `null` when nothing produces it yet.
     *
     * `file` is relative to `apps/api/src`. Each entry of `titles` must name
     * exactly one `it()` / `test()` title inside it.
     */
    readonly covered: { readonly file: string; readonly titles: readonly string[] } | null;
    /** For an uncovered row: what a test would have to do. */
    readonly missing?: string;
}

export const ACCEPTANCE_MATRIX: readonly AcceptanceScenario[] = Object.freeze([
    {
        scenario: 'Mismas 20 respuestas, Colombia/Perú/Alemania',
        evidence: 'Reserva según mercado y moneda; cifras consistentes con tarjeta versionada',
        covered: {
            file: 'modules/billing/whatsapp-spend/campaign-estimate.spec.ts',
            titles: ['prices every recipient at their OWN market rate'],
        },
    },
    {
        scenario: 'Tres fotos con captions y un link',
        evidence: 'Efectos reales contados, semántica/recibos preservados',
        covered: {
            file: 'modules/channels/dispatch-items.spec.ts',
            titles: ['folds the caption onto the attachment where the provider bills them as one'],
        },
    },
    {
        scenario: 'Dos workers, último saldo',
        evidence: 'Sólo gasto autorizado; ninguna doble asignación',
        covered: {
            file: 'modules/billing/whatsapp-spend/spend-ledger.postgres.spec.ts',
            titles: ['lets exactly one through, and the sum never exceeds the cap'],
        },
    },
    {
        scenario: 'Cuota 999/1000/1001 y varios países',
        evidence: 'Cuota por número, no multiplicada por mercado',
        covered: {
            file: 'modules/billing/whatsapp-spend/free-allowance.postgres.spec.ts',
            // Two halves, two tests: the boundary itself, and the fact that a
            // second number gets its own thousand rather than the tenant's one
            // being shared. The row used to name `999`, which is in that file
            // only as prose.
            titles: [
                'is still free at the 1000th and charges from the 1001st',
                'gives each number of a tenant its own thousand',
            ],
        },
    },
    {
        scenario: 'Varios números/cuentas',
        evidence: 'Cuotas, pagador y pausa correctos, sin contaminación de debounce',
        covered: {
            file: 'modules/billing/whatsapp-spend/calendar-month-consumption.postgres.spec.ts',
            titles: ['never pools two numbers into one figure'],
        },
    },
    {
        scenario: 'Destino o estado de cuota desconocidos',
        evidence: 'Sin costo cero supuesto ni éxito falso',
        covered: {
            file: 'modules/billing/whatsapp-spend/campaign-estimate.spec.ts',
            titles: ['counts a market the card does not know instead of dropping it'],
        },
    },
    {
        scenario: 'Cambio septiembre/octubre en cola',
        evidence: 'Revalidación y política correspondiente a la entrega/contrato',
        covered: {
            file: 'modules/billing/whatsapp-rates/whatsapp-rate-resolver.spec.ts',
            titles: ['is inclusive of the boundary: 00:00:00 belongs to the new card'],
        },
    },
    {
        scenario: 'Timeout, reinicio y entrega tardía',
        evidence: 'Reserva incierta retenida y cero reenvíos por reintento ciego',
        covered: {
            file: 'modules/billing/whatsapp-spend/spend-ledger.postgres.spec.ts',
            titles: ['adopts a retained reservation with its uncertainty, not a fresh one'],
        },
    },
    {
        scenario: 'Cuenta con otro proveedor',
        evidence: 'Alcance y beneficio incierto explícitos',
        covered: {
            file: 'modules/billing/whatsapp-spend/spend-scopes.spec.ts',
            titles: ['says what a ceiling CANNOT promise, wherever a ceiling is the reason'],
        },
    },
    {
        scenario: 'Pregunta resuelta y cinco "gracias"',
        evidence: 'Sin cadena nueva de respuestas automáticas',
        covered: null,
        missing: 'la política de repetición cubre el mismo TEXTO repetido, no el caso de cinco '
            + 'agradecimientos distintos después de una pregunta ya resuelta. Falta el turno que '
            + 'decide no contestar',
    },
    {
        scenario: 'Cliente confundido o reclamando',
        evidence: 'Reparación/atención legítima; no etiqueta automática de abuso',
        covered: {
            file: 'modules/conversations/turn-outcome-wait.spec.ts',
            titles: ['answers a complaint, a rephrasing, another language and a request for a person'],
        },
    },
    {
        scenario: 'Misma pregunta requerida sin progreso',
        evidence: 'Reformulación limitada y vía alternativa, sin loop',
        covered: null,
        missing: 'falta la prueba de que una reformulación del mismo dato sin cambio se detiene y '
            + 'ofrece otra vía, en vez de repetir la pregunta',
    },
    {
        scenario: 'Nueva necesidad después de pausa',
        evidence: 'Revisión de intención sin reiniciar límites financieros',
        covered: {
            file: 'modules/billing/whatsapp-spend/spend-ceiling.postgres.spec.ts',
            titles: ['raises one without losing what has been counted'],
        },
    },
    {
        scenario: 'Bot contra bot y ráfaga de contactos',
        evidence: 'Pausa/contacto y techo agregado; avisos acotados',
        covered: null,
        missing: 'el MECANISMO está probado —cien turnos contra un techo de diez se detienen en '
            + 'diez, y el bucle de un contacto no silencia a los demás— pero NO hay techo por '
            + 'contacto por defecto: todo alcance salvo la franquicia se crea en `observe`, así '
            + 'que en un tenant que no configuró nada el bucle corre hasta que alguien ve la '
            + 'factura. Elegir ese número es una decisión de producto, y este programa ya publicó '
            + 'un techo cuyo umbral adivinado frenó exactamente lo que debía permitir',
    },
    {
        scenario: 'Humano, REST, campaña y recordatorio',
        evidence: 'Todos atraviesan admisión; nadie evita el control por origen',
        covered: null,
        // This row said it was answered by `claims durable dispatch only for the
        // item kinds the outbox can carry`, which asserts the seven item kinds
        // the outbox accepts and that the agent's own durable reply is
        // `pilot_gated`. Nothing in it is about the human console, the REST API
        // or campaigns reaching admission — and the closure report says as much
        // on the facing page: R4 is open because "7 productores todavía pueden
        // emitir sin fila durable". A row cannot be covered by the same fact
        // that keeps two other rows open.
        missing: 'la prueba que se le atribuía sólo dice qué tipos de ítem puede llevar el outbox '
            + 'durable y que la respuesta del agente sigue en `pilot_gated`: no toca la consola '
            + 'humana, ni la API REST, ni las campañas, ni los recordatorios. Falta la prueba de '
            + 'que un envío de cada uno de esos cuatro orígenes atraviesa la MISMA admisión que '
            + 'el agente —reserva, techo y franquicia antes del POST— en vez de llegar al '
            + 'proveedor por un carril propio. Hoy el contador de R0/R4 dice que siete '
            + 'productores cobrables siguen fuera del carril durable, así que la prueba '
            + 'fallaría: primero hay que mover los productores, y recién entonces fijarlo',
    },
    {
        scenario: 'Nurturing fuera de ventana/baja/cap',
        evidence: 'Cero efecto no permitido; no fallback más permisivo',
        // ── A ROW IS ONLY AS COVERED AS ITS THINNEST HALF ───────────────────
        //
        // Two of the three are answered and named below in `missing` for
        // whoever closes this: the out-of-window nudge goes as the tenant's
        // approved template rather than as free text, and the daily cap refuses
        // the second one. The third is `baja` — the opt-out — and it is not
        // covered because it is not IMPLEMENTED: `drip-sequence.service.ts`
        // checks `leads.opted_out` and `compliance.isBlocked` before enrolling,
        // and `nurturing.service.ts` checks neither.
        //
        // Marking it covered on the strength of the handoff test was the error
        // the review caught: a thread handed to a person is not a customer who
        // asked to stop hearing from us, and reading one as the other is how a
        // scenario about consent gets closed by a test about routing.
        covered: null,
        missing: 'nurturing no consulta ninguna baja. `drip-sequence.service.ts:327-330` salta '
            + 'los contactos con `leads.opted_out` o bloqueados por compliance antes de '
            + 'inscribirlos; `nurturing.service.ts` no mira ninguno de los dos, así que un '
            + 'contacto que pidió no recibir más mensajes sigue recibiendo nudges. Las otras '
            + 'dos mitades SÍ están probadas en `nurturing-durable-lane.postgres.spec.ts` '
            + '(«commits an out-of-window nudge», «still refuses a second nudge the same day»); '
            + 'falta la compuerta de baja y su prueba, en ese orden',
    },
    {
        scenario: 'Operación ejecutada antes de pausa',
        evidence: 'Conserva resultado y obligación de confirmación recuperable',
        covered: {
            file: 'modules/channels/proactive-lane-semantics.postgres.spec.ts',
            titles: [
                'KEEPS the effect when the refusal was',
                'leaves a held-back effect claimable once the condition clears',
            ],
        },
    },
    {
        scenario: 'Flow/formulario/Web Chat',
        evidence: 'El inicio y confirmaciones WA cuentan; continuidad segura y opcional',
        covered: {
            file: 'modules/channels/flow-one-post.spec.ts',
            // `flow` used to be the fragment, and it matched a mock payload.
            titles: [
                'does not become a second message on an unreadable answer either',
                'becomes text only when the fallback is authorised',
                'sends nothing when the fallback is refused',
            ],
        },
    },
]);

/** The scenarios nothing answers yet. This is the number R5 reports. */
export function uncoveredScenarios(
    rows: readonly AcceptanceScenario[] = ACCEPTANCE_MATRIX,
): readonly AcceptanceScenario[] {
    return Object.freeze(rows.filter(row => row.covered === null));
}
