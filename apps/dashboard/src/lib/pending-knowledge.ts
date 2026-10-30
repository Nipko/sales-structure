/**
 * Bandeja de conocimiento pendiente (C0 §1.5 y §1.6, rebanada R5, ADR 0011): tipos de `GET /readiness/:t/pending` y
 * el orden de la bandeja. La API ya ordena (abiertas primero, por SLA y demanda); aquí solo se decide qué se muestra.
 */
import type { BusinessFactWriteResponse } from "./readiness-forms";

export type PendingStatus = "gap" | "open" | "answered" | "stored" | "closed" | "dismissed";
export type PendingFilter = "active" | "answered" | "stored" | "dismissed" | "all";

export interface PendingWaiter {
    id: string;
    conversationId: string;
    contactId: string | null;
    language: string | null;
    acceptedAt: string | null;
    notifiedAt: string | null;
    notifyStatus: string;
    notifyDetail: string | null;
}

export interface PendingQuestion {
    id: string;
    requirementId: string | null;
    itemRef: string | null;
    topicKey: string;
    sampleQuestion: string;
    language: string | null;
    source: "agent" | "retrieval" | string;
    status: PendingStatus;
    occurrences: number;
    waitersCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    slaDueAt: string | null;
    overdue: boolean;
    answeredAt: string | null;
    answerText: string | null;
    storedValueId: string | null;
    waiters?: PendingWaiter[];
}

export interface PendingList {
    items: PendingQuestion[];
    counts: Record<PendingStatus | "overdue", number>;
}

export type NotifySummary = Partial<Record<string, number>>;

export interface PendingStoreResponse extends BusinessFactWriteResponse {
    question: PendingQuestion;
    resolved: string[];
    notified: NotifySummary;
}

/** Cuántas consultas esperan al dueño (el contador de la navegación): abiertas con clientes esperando + solo demanda. */
export function pendingBadgeCount(counts: Partial<PendingList["counts"]> | null | undefined): number {
    return Number(counts?.open ?? 0) + Number(counts?.gap ?? 0);
}

/** Qué acciones admite una consulta según su estado (la API es la que decide; esto solo evita botones inútiles). */
export function pendingActions(q: Pick<PendingQuestion, "status" | "requirementId">): { answer: boolean; store: boolean; dismiss: boolean; close: boolean; renotify: boolean } {
    const open = q.status === "gap" || q.status === "open";
    const answered = q.status === "answered" || q.status === "stored";
    return {
        answer: open,
        store: Boolean(q.requirementId) && (open || q.status === "answered"),
        dismiss: open,
        close: answered,
        renotify: answered,
    };
}

/** Horas hasta el SLA (negativo = vencido), redondeadas hacia el lado que no engaña. */
export function hoursToSla(slaDueAt: string | null, now = new Date()): number | null {
    if (!slaDueAt) return null;
    const ms = new Date(slaDueAt).getTime() - now.getTime();
    if (!Number.isFinite(ms)) return null;
    return ms >= 0 ? Math.ceil(ms / 3_600_000) : -Math.ceil(-ms / 3_600_000);
}
