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

/**
 * El valor propuesto como líneas legibles: `campo: valor` (las listas de texto separadas por comas); lo anidado, como
 * JSON compacto. Nunca se oculta una parte del valor: lo que se aprueba es exactamente lo que se ve.
 */
export function formatProposalValue(value: unknown): string[] {
    if (value === null || value === undefined) return [];
    if (primitive(value)) return [show(value)];
    if (Array.isArray(value)) {
        return value.every(primitive) ? [value.map(show).join(", ")] : value.map(v => (primitive(v) ? show(v) : JSON.stringify(v)));
    }
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        if (primitive(v)) return `${k}: ${show(v)}`;
        if (Array.isArray(v) && v.every(primitive)) return `${k}: ${v.map(show).join(", ")}`;
        return `${k}: ${JSON.stringify(v)}`;
    });
}
