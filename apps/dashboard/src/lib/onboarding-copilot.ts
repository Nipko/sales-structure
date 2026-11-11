/**
 * Propuestas del copiloto de onboarding (C0 §1.3 y §1.6, rebanada R6, ADR 0012): tipos de `GET /readiness/:t/copilot/
 * proposals` y qué se muestra de cada una. La API decide (aprobar exige una persona, una pregunta no se aprueba, lo
 * caducado ya no se aprueba); aquí solo se evitan botones inútiles y se da forma legible al valor propuesto.
 */
import type { BusinessFactWriteResponse } from "./readiness-forms";

export type CopilotProposalKind = "value" | "contradiction" | "question";
export type CopilotProposalStatus = "proposed" | "applied" | "expired" | "rejected" | "superseded";
export type CopilotFilter = "open" | "applied" | "rejected" | "superseded" | "expired" | "all";

export interface CopilotEvidence {
    sourceRef: string;
    origin: string;
    label: string;
    url: string | null;
    quote: string;
}

export interface CopilotQuestion {
    code: "owner_question" | "generic_faq";
    text?: string;
    faq?: { id: string; question: string; reason: "seeded" | "example" | "without_data" | string };
}

export interface CopilotProposal {
    id: string;
    kind: CopilotProposalKind;
    requirementId: string;
    requirementTitle: string | null;
    targetRef: string;
    status: CopilotProposalStatus;
    value: unknown;
    current: unknown;
    alternatives: { value: unknown; evidence: CopilotEvidence[] }[];
    question: CopilotQuestion | null;
    evidence: CopilotEvidence[];
    runId: string | null;
    createdAt: string;
    expiresAt: string;
    decidedAt: string | null;
    decisionNote: string | null;
    factId: string | null;
}

export interface CopilotProposalList {
    items: CopilotProposal[];
    counts: Record<CopilotProposalStatus, number>;
}

export interface CopilotRunSummary {
    runId: string;
    model: string | null;
    sources: number;
    targets: number;
    proposed: number;
    contradictions: number;
    questions: number;
    discarded: { requirementId: string; code: string; message: string }[];
    note: "no_sources" | "nothing_missing" | "malformed_response" | "llm_unavailable" | null;
}

export interface CopilotApproveResponse extends BusinessFactWriteResponse {
    proposal: CopilotProposal;
}

/** Filtro de la pantalla → `?status=` de la API (`open` = propuestas abiertas). */
export const COPILOT_FILTERS: CopilotFilter[] = ["open", "applied", "rejected", "superseded", "expired", "all"];

/** Cuántas propuestas esperan al dueño (el contador del enlace en el panel). */
export function copilotBadgeCount(counts: Partial<CopilotProposalList["counts"]> | null | undefined): number {
    return Number(counts?.proposed ?? 0);
}

/** Qué acciones admite una propuesta según su tipo y estado. */
export function copilotActions(p: Pick<CopilotProposal, "kind" | "status" | "value" | "alternatives" | "question">): {
    approve: boolean; edit: boolean; choose: boolean; reject: boolean; answer: boolean; openFaqs: boolean;
} {
    const open = p.status === "proposed";
    const valued = p.kind !== "question";
    return {
        approve: open && valued && p.value !== null && p.value !== undefined,
        edit: open && valued,
        choose: open && p.kind === "contradiction" && p.alternatives.length > 0,
        reject: open,
        answer: open && p.kind === "question" && p.question?.code === "owner_question",
        openFaqs: open && p.question?.code === "generic_faq",
    };
}

const primitive = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const show = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "✓" : "✗") : String(v));

/** Cómo nombrar las claves del valor en la tarjeta (las traducciones del cajón); sin ellas, la clave tal cual. */
export interface ProposalValueLabels {
    field?: (key: string) => string;
    day?: (key: string) => string;
    option?: (value: string) => string;
    closed?: string;
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Un tramo de horario, en la forma guardada (`{open, close}`) o en la que a veces propone el copiloto. */
function spanText(span: unknown): string {
    if (Array.isArray(span) && span.length === 2) return `${show(span[0])}–${show(span[1])}`;
    if (isRecord(span)) return `${show(span.open ?? span.from)}–${show(span.close ?? span.to)}`;
    return show(span);
}

/**
 * El valor propuesto como líneas legibles (ADR 0031, fricción 3: nada de JSON crudo en la tarjeta): `campo: valor`, el
 * horario día por día, el contacto canal por canal y lo anidado como `campo: valor · campo: valor`. Nunca se oculta
 * una parte del valor: lo que se aprueba es exactamente lo que se ve.
 */
export function formatProposalValue(value: unknown, labels: ProposalValueLabels = {}): string[] {
    const field = labels.field ?? ((k: string) => k);
    const day = labels.day ?? ((k: string) => k);
    const option = labels.option ?? ((v: string) => v);
    const atom = (v: unknown): string => (typeof v === "string" ? option(v) : show(v));
    const inline = (v: unknown): string => {
        if (primitive(v)) return atom(v);
        if (Array.isArray(v)) return v.every(primitive) ? v.map(atom).join(", ") : v.map(inline).join("; ");
        return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${field(k)}: ${inline(x)}`).join(" · ");
    };
    const hours = (days: Record<string, unknown>): string[] => [...DAY_ORDER.filter(d => d in days), ...Object.keys(days).filter(d => !DAY_ORDER.includes(d))]
        .map(d => {
            const spans = Array.isArray(days[d]) ? days[d] as unknown[] : [days[d]];
            const isPair = spans.length === 2 && spans.every(x => typeof x === "string");
            const list = isPair ? [spans] : spans;
            return `${day(d)}: ${list.length ? list.map(spanText).join(", ") : labels.closed ?? "—"}`;
        });
    const point = (p: unknown): string => (isRecord(p)
        ? `${atom(p.kind ?? "")}: ${show(p.value)}${p.label ? ` (${show(p.label)})` : ""}`
        : inline(p));

    if (value === null || value === undefined) return [];
    if (primitive(value)) return [atom(value)];
    if (Array.isArray(value)) return value.every(primitive) ? [value.map(atom).join(", ")] : value.map(inline);
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
        if (k === "days" && isRecord(v)) return hours(v);
        if (k === "points" && Array.isArray(v)) return v.length ? v.map(point) : [`${field(k)}: —`];
        if (isRecord(v) && isRecord(v.days)) return [`${field(k)}:`, ...hours(v.days).map(line => `  ${line}`)];
        return [`${field(k)}: ${inline(v)}`];
    });
}
