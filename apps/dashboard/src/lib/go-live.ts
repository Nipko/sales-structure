/**
 * Control de salida en el panel de preparación (C0 §1.2 y §1.6, rebanada R4, ADR 0010).
 *
 * `GET /readiness/:tenantId/go-live` trae el estado (publicado o no), el modo (sombra o aplicado), la decisión de hoy
 * y el informe de sombra. Aquí solo se decide qué acción mostrar; la regla (409 si no_listo, reconocimiento de
 * «limitado») vive en la API.
 */
import type { ReadinessVerdict } from "@/lib/readiness-panel";

export type GoLiveState = "off" | "on";
export type GoLiveMode = "shadow" | "enforce";
export type GoLiveReason = "published" | "published_regressed" | "not_published" | "no_listo" | "test_contact" | "unavailable";

export interface GoLiveIntent { id: string; title: string; requirementIds?: string[] }

export interface GoLiveStatus {
    state: GoLiveState;
    at: string | null;
    by: string | null;
    specVersion: string | null;
    ack: { verdict: ReadinessVerdict; intents: GoLiveIntent[]; acknowledgedAt: string; acknowledgedBy: string | null } | null;
    mode: GoLiveMode;
    decision: { serve: boolean; reason: GoLiveReason };
    lastDecision: { serve: boolean; reason: GoLiveReason; mode: GoLiveMode; channelType: string; verdict: string | null; createdAt: string } | null;
    summary: { days: number; total: number; wouldBlock: number; byReason: Record<string, number>; since: string | null };
}

export type GoLiveAction =
    /** Publicado: se puede despublicar. */
    | { kind: "unpublish" }
    /** Listo: se publica sin reconocimiento. */
    | { kind: "publish" }
    /** Limitado: se publica reconociendo cada intención que quedará en «no consta». */
    | { kind: "publish_limited"; intents: GoLiveIntent[] }
    /** No listo: no se puede publicar (la API respondería 409). */
    | { kind: "blocked" }
    /** Sin permiso de escritura (supervisor, o la plataforma sin suplantar). */
    | { kind: "read_only" };

export function goLiveAction(status: Pick<GoLiveStatus, "state">, verdict: ReadinessVerdict, limitedIntents: GoLiveIntent[], canWrite: boolean): GoLiveAction {
    if (!canWrite) return { kind: "read_only" };
    if (status.state === "on") return { kind: "unpublish" };
    if (verdict === "no_listo") return { kind: "blocked" };
    if (verdict === "limitado") return { kind: "publish_limited", intents: limitedIntents };
    return { kind: "publish" };
}

/** «Limitado»: publicar solo cuando el dueño marcó TODAS las intenciones (la API exige lo mismo). */
export const ackComplete = (intents: GoLiveIntent[], checked: ReadonlySet<string>): boolean => intents.every(i => checked.has(i.id));
