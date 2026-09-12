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

export interface AcceptanceCoverage {
    /** Relative to `apps/api/src`. */
    readonly file: string;
    /** Each one must match exactly one `it()` title in that file. */
    readonly titles: readonly string[];
}

/** Every place a scenario's evidence is produced, as a list either way. */
export function coveragePlaces(
    covered: AcceptanceScenario['covered'],
): readonly AcceptanceCoverage[] {
    if (!covered) return [];
    return Array.isArray(covered) ? covered : [covered as AcceptanceCoverage];
}

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
     *
     * A LIST when the evidence the handoff asks for is produced in more than
     * one place. That is not a convenience: «bot contra bot y ráfaga de
     * contactos» asks for a per-contact pause, an aggregate ceiling AND
     * bounded notices, and the ceilings live in the ledger while the notice
     * budget lives in the turn. Forcing one file would mean either moving a
     * test to where it does not belong or naming half the evidence.
     */
    readonly covered: AcceptanceCoverage | readonly AcceptanceCoverage[] | null;
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
        // ── WHAT CLOSED IT, AND WHY THE SECOND TITLE IS NOT OPTIONAL ────────
        //
        // The gap was real and the reason was structural: the repetition guard
        // compares a digest of what is being sent, and five different
        // courtesies are five different digests. So the chain was stopped one
        // level up, in the turn's own outcome — a goodbye of OURS is recorded,
        // and the second one in the episode becomes a `wait` with no effects.
        //
        // A saving made by not answering people is not a saving, so the row
        // names the guard too: with the goodbye budget already spent, the very
        // next real question is still answered. The thin half of THIS row is
        // not "did it stop" but "did it stop something it should not have".
        covered: {
            file: 'modules/conversations/courtesy-chain-and-stalled-ask.postgres.spec.ts',
            titles: [
                'closes once, and lets four more thank-yous cost nothing',
                'still answers a real question asked in the middle of the thank-yous',
            ],
        },
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
        // ── THREE HALVES, AND A FOURTH TITLE THAT GUARDS THEM ───────────────
        //
        // *Reformulación limitada*: two turns may go by awaiting one datum —
        // the question and one more attempt — counted per DATUM, off the
        // procedure runtime's own durable state rather than off a judgement
        // that two sentences meant the same thing.
        //
        // *Vía alternativa*: the third turn hands the conversation to a person
        // and says so once, from the closed handoff catalog. Measured before,
        // on both lanes: four asks straight through and no route at all. The
        // spend gate's digest guard was never the alternative — it refuses a
        // VERBATIM repeat and offers nothing behind the refusal, which is
        // silence rather than another way, and a rephrased loop it cannot see.
        // Both lanes are named because both had to grow the route.
        //
        // *Sin loop*: the announcement is once per episode, so a thread a
        // person finishes and hands back does not buy a second one.
        //
        // The fourth title is the two guards composing: a model that repeats
        // itself word for word is refused by the money authority, and the
        // refusal must not swallow the escalation — a silent turn that never
        // reached the counter would leave the customer with one unanswered
        // question and no way out.
        //
        // And the last is the guard all of them need: an intake that collects a
        // different field every turn is four question-only turns in a row, and
        // it must never be stopped.
        covered: {
            file: 'modules/conversations/courtesy-chain-and-stalled-ask.postgres.spec.ts',
            titles: [
                'hands the conversation over instead of asking a third time',
                'offers the person on the legacy lane too, which had no route at all',
                'does not announce the handover twice when the agent gets the thread back',
                'refuses a verbatim second ask and still offers the person',
                'never stops an intake that collects a different datum every turn',
            ],
        },
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
        // ── TRES EXIGENCIAS, Y LA QUE NO ES CÓDIGO ──────────────────────
        //
        // *Pausa/contacto*: cien turnos de un contacto contra un techo de
        // diez se detienen en diez, y el bucle de uno no silencia a los
        // demás. Ya estaba.
        //
        // *Techo agregado*: lo que faltaba. Cuarenta personas escribiendo
        // una vez cada una son cuarenta primeros mensajes, todos legítimos en
        // su propio alcance — ningún techo por contacto puede ver una
        // ráfaga. La acota el techo de la CUENTA, que es otro alcance que
        // cobra la misma admisión.
        //
        // *Avisos acotados*: el primero sale y el segundo del mismo episodio
        // se convierte en una espera que no envía nada, así que un techo que
        // rechaza cien veces no produce cien avisos.
        //
        // Lo que sigue afuera no es una prueba: **no hay techo por contacto
        // POR DEFECTO**. Todo alcance salvo la franquicia se crea en
        // `observe`, y eso se afirma en vez de dejarse descubrir — `does NOT
        // bound it while the contact is only being observed`. Las
        // consecuencias también se miden en vez de discutirse: con techo
        // agregado y sin techo por contacto, UN bot que contesta a nuestro
        // bot gasta la cuota de la cuenta y el siguiente cliente real queda
        // sin respuesta. Elegir ese número es del dueño, y este programa ya
        // publicó un techo cuyo umbral adivinado frenó exactamente lo que
        // debía permitir.
        covered: [
            {
                file: 'modules/billing/whatsapp-spend/spend-ceiling.postgres.spec.ts',
                titles: [
                    'bounds a runaway loop on one contact once a ceiling is set',
                    'stops the narrowest thing it can: one contact, not the account',
                    'bounds a BURST of different contacts at the aggregate ceiling',
                    'lets ONE looping contact exhaust that aggregate and silence everybody else',
                    'and a per-contact ceiling is what keeps the aggregate for everybody else',
                    'does NOT bound it while the contact is only being observed',
                ],
            },
            {
                file: 'modules/conversations/turn-outcome-wait.spec.ts',
                titles: [
                    'lets the first failure notice through — a customer is told once',
                    'turns the second one in the same episode into a wait that sends nothing',
                ],
            },
        ],
    },
    {
        scenario: 'Humano, REST, campaña y recordatorio',
        evidence: 'Todos atraviesan admisión; nadie evita el control por origen',
        // Five production boundaries answer the one scenario. The four origin
        // specs prove that their request stack leaves a dispatch row and does
        // not POST; the processor spec proves every such row asks the shared
        // spend authority before transport. The human-only inline fallback is
        // named too, because it remains intentionally available during rollout
        // and has to preserve the same order even without an outbox row.
        covered: [
            {
                file: 'modules/agent-console/agent-console-durable-lane.postgres.spec.ts',
                titles: [
                    'commits a row instead of POSTing on the request stack',
                    'admits the inline human fallback before its provider POST',
                ],
            },
            {
                file: 'modules/whatsapp/whatsapp-rest-durable-lane.postgres.spec.ts',
                titles: ['commits a durable row instead of posting to Meta on the request stack'],
            },
            {
                file: 'modules/broadcast/broadcast-durable-lane.postgres.spec.ts',
                titles: ['leaves the recipient queued so the effect can still be admitted'],
            },
            {
                file: 'modules/appointments/reminder-durable-lane.postgres.spec.ts',
                titles: ['prepares a row the real store accepts'],
            },
            {
                file: 'modules/channels/proactive-lane-semantics.postgres.spec.ts',
                titles: ['asks shared spend admission before any durable provider POST'],
            },
        ],
    },
    {
        scenario: 'Nurturing fuera de ventana/baja/cap',
        evidence: 'Cero efecto no permitido; no fallback más permisivo',
        // ── A ROW IS ONLY AS COVERED AS ITS THINNEST HALF ───────────────────
        //
        // Three halves, three titles. Marking the row covered on the strength of
        // the HANDOFF test was the error the review caught: a thread handed to a
        // person is not a customer who asked to stop hearing from us, and
        // reading one as the other closes a scenario about consent with a test
        // about routing.
        //
        // The opt-out half then turned out to be half-built rather than absent —
        // `nurturing.service.ts` did check `compliance.isBlocked`, but not the
        // `leads.opted_out` flag the public unsubscribe form sets, which
        // `drip-sequence.service.ts:327-330` checks precisely because
        // `isBlocked` cannot see it. So a customer who pressed unsubscribe went
        // on being nudged by the one producer whose whole purpose is writing to
        // people who stopped replying. The gate exists now, and the title below
        // is the test that would fail if it were removed.
        covered: {
            file: 'modules/automation/nurturing-durable-lane.postgres.spec.ts',
            titles: [
                'commits an out-of-window nudge',
                'sends nothing to a contact who used the unsubscribe link',
                'still refuses a second nudge the same day',
            ],
        },
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
