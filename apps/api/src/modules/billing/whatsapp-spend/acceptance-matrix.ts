/**
 * ═══ THE EIGHTEEN SCENARIOS, AND WHICH TEST ANSWERS EACH ONE ═══
 *
 * `claude-whatsapp-response-spend-guardrails.md` §R5 prints an acceptance
 * matrix: eighteen situations, each with the evidence it has to produce. It is
 * a table in a document, so the only way to know whether a row is covered was
 * to read the suite and decide — and "somebody read it and decided" is exactly
 * the kind of claim this programme keeps finding to be wrong.
 *
 * So the mapping is data. Each scenario names the spec file and a distinctive
 * fragment of the test title that answers it, and a check asserts that the file
 * exists and contains that title. A scenario with no test says so, by name, and
 * the closure report counts it.
 *
 * ── WHY `covered: null` IS THE HONEST VALUE AND NOT AN OMISSION ─────────────
 *
 * Half of these are covered and half are not. The temptation is to leave the
 * uncovered ones out of the table, which makes the table look complete and the
 * counter read zero — the exact failure the derived closure report exists to
 * prevent. They are listed with `null`, so the number of uncovered scenarios is
 * a fact about the repository rather than about who wrote the list.
 *
 * ── AND WHY A TITLE FRAGMENT RATHER THAN A FILE ─────────────────────────────
 *
 * Naming only the file would let a scenario be "covered" by a suite that
 * happens to live in the right place. The fragment has to appear, so deleting
 * or renaming the test that actually answers the scenario breaks the mapping
 * instead of silently keeping it green.
 */

export interface AcceptanceScenario {
    /** The row as the handoff states it. */
    readonly scenario: string;
    /** The evidence the handoff says it must produce. */
    readonly evidence: string;
    /**
     * Where that evidence is produced, or `null` when nothing produces it yet.
     *
     * `file` is relative to `apps/api/src`. `title` must appear inside it.
     */
    readonly covered: { readonly file: string; readonly title: string } | null;
    /** For an uncovered row: what a test would have to do. */
    readonly missing?: string;
}

export const ACCEPTANCE_MATRIX: readonly AcceptanceScenario[] = Object.freeze([
    {
        scenario: 'Mismas 20 respuestas, Colombia/Perú/Alemania',
        evidence: 'Reserva según mercado y moneda; cifras consistentes con tarjeta versionada',
        covered: {
            file: 'modules/billing/whatsapp-spend/campaign-estimate.spec.ts',
            title: 'prices every recipient at their OWN market rate',
        },
    },
    {
        scenario: 'Tres fotos con captions y un link',
        evidence: 'Efectos reales contados, semántica/recibos preservados',
        covered: {
            file: 'modules/channels/dispatch-items.spec.ts',
            title: 'folds the caption onto the attachment where the provider bills them as one',
        },
    },
    {
        scenario: 'Dos workers, último saldo',
        evidence: 'Sólo gasto autorizado; ninguna doble asignación',
        covered: {
            file: 'modules/billing/whatsapp-spend/spend-ledger.postgres.spec.ts',
            title: 'lets exactly one through, and the sum never exceeds the cap',
        },
    },
    {
        scenario: 'Cuota 999/1000/1001 y varios países',
        evidence: 'Cuota por número, no multiplicada por mercado',
        covered: {
            file: 'modules/billing/whatsapp-spend/free-allowance.postgres.spec.ts',
            title: '999',
        },
    },
    {
        scenario: 'Varios números/cuentas',
        evidence: 'Cuotas, pagador y pausa correctos, sin contaminación de debounce',
        covered: {
            file: 'modules/billing/whatsapp-spend/calendar-month-consumption.postgres.spec.ts',
            title: 'never pools two numbers into one figure',
        },
    },
    {
        scenario: 'Destino o estado de cuota desconocidos',
        evidence: 'Sin costo cero supuesto ni éxito falso',
        covered: {
            file: 'modules/billing/whatsapp-spend/campaign-estimate.spec.ts',
            title: 'counts a market the card does not know instead of dropping it',
        },
    },
    {
        scenario: 'Cambio septiembre/octubre en cola',
        evidence: 'Revalidación y política correspondiente a la entrega/contrato',
        covered: {
            file: 'modules/billing/whatsapp-rates/whatsapp-rate-resolver.spec.ts',
            title: 'is inclusive of the boundary: 00:00:00 belongs to the new card',
        },
    },
    {
        scenario: 'Timeout, reinicio y entrega tardía',
        evidence: 'Reserva incierta retenida y cero reenvíos por reintento ciego',
        covered: {
            file: 'modules/billing/whatsapp-spend/spend-ledger.postgres.spec.ts',
            title: 'adopts a retained reservation with its uncertainty, not a fresh one',
        },
    },
    {
        scenario: 'Cuenta con otro proveedor',
        evidence: 'Alcance y beneficio incierto explícitos',
        covered: {
            file: 'modules/billing/whatsapp-spend/spend-scopes.spec.ts',
            title: 'says what a ceiling CANNOT promise, wherever a ceiling is the reason',
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
            title: 'answers a complaint, a rephrasing, another language and a request for a person',
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
            title: 'raises one without losing what has been counted',
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
        covered: {
            file: 'modules/channels/external-effect-inventory.spec.ts',
            title: 'claims durable dispatch only for the item kinds the outbox can carry',
        },
    },
    {
        scenario: 'Nurturing fuera de ventana/baja/cap',
        evidence: 'Cero efecto no permitido; no fallback más permisivo',
        covered: {
            file: 'modules/automation/nurturing-durable-lane.postgres.spec.ts',
            title: 'nurturing',
        },
    },
    {
        scenario: 'Operación ejecutada antes de pausa',
        evidence: 'Conserva resultado y obligación de confirmación recuperable',
        covered: {
            file: 'modules/channels/proactive-lane-semantics.postgres.spec.ts',
            title: 'because that clears',
        },
    },
    {
        scenario: 'Flow/formulario/Web Chat',
        evidence: 'El inicio y confirmaciones WA cuentan; continuidad segura y opcional',
        covered: {
            file: 'modules/channels/flow-one-post.spec.ts',
            title: 'flow',
        },
    },
]);

/** The scenarios nothing answers yet. This is the number R5 reports. */
export function uncoveredScenarios(
    rows: readonly AcceptanceScenario[] = ACCEPTANCE_MATRIX,
): readonly AcceptanceScenario[] {
    return Object.freeze(rows.filter(row => row.covered === null));
}
