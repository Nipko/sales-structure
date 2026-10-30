/**
 * Panel de preparación (C0 §1.6, rebanada R2) — forma de los datos para la pantalla.
 *
 * Solo ordena y agrupa lo que el motor ya decidió (`GET /readiness/:tenantId`): el veredicto, qué falla en
 * cada nivel y por qué los decide `@parallext/business-spec` en la API. Aquí no hay ninguna regla de
 * preparación; solo agrupación, causa raíz para no repetir huecos, y si el rol puede abrir el enlace.
 *
 * Los tipos son la parte del `ReadinessResult` que lee el panel (readiness-panel.spec.ts comprueba que el
 * resultado real del motor encaja en ellos).
 */
import { canAccessPath, type Role } from "@/lib/roles";

export type ReadinessVerdict = "no_listo" | "limitado" | "listo";
export type ReadinessLevel = "bloqueante" | "necesario" | "recomendado";

export interface ReadinessGapView {
    cause: string;
    message: string;
    intents: { id: string; title: string }[];
    uiTarget: string | null;
    uiToday: string;
    rootOf: string[];
    rootCause?: string;
}

export interface ReadinessRequirementView {
    id: string;
    title: string;
    layer: string;
    level: ReadinessLevel;
    applies: boolean;
    result: "cumple" | "parcial" | "no_cumple" | "n/a";
    valueState: string | null;
    ratio?: { ok: number; total: number };
    platform: boolean;
    derived: boolean;
    detail?: string;
    gap?: ReadinessGapView;
}

export interface ReadinessResultView {
    specVersion: string;
    asOf: string;
    resultHash: string;
    verdict: ReadinessVerdict;
    counts: {
        applicable: number; blocking: number; blockingFailing: number; necessary: number; necessaryFailing: number;
        recommended: number; recommendedFailing: number;
    };
    requirements: ReadinessRequirementView[];
    blockingGaps: string[];
    necessaryGaps: string[];
    recommendedGaps: string[];
    platformGaps: { id: string; message: string }[];
    qualityWarnings: { id: string; message: string; uiTarget: string | null }[];
    coverage: { byArea: Record<string, { ok: number; total: number }>; r5Pct: number };
    limitedIntents: { id: string; title: string; requirementIds: string[] }[];
}

/** Respuesta de `GET /readiness/:tenantId`. */
export interface ReadinessCurrentResponse {
    evaluationId: string | null;
    evaluatedAt: string;
    trigger: string;
    cached: boolean;
    result: ReadinessResultView;
}

/** Fila de `GET /readiness/:tenantId/history`. */
export interface ReadinessHistoryEntry {
    id: string;
    specVersion: string;
    verdict: ReadinessVerdict;
    resultHash: string;
    counts: ReadinessResultView["counts"];
    blockingGaps: string[];
    trigger: string;
    createdAt: string;
}

/** Dónde se arregla un hueco, para el rol que mira el panel. */
export type GapAction =
    | { kind: "link"; href: string }
    /** La pantalla existe pero el rol no la puede abrir: se pide al administrador, sin enlace. */
    | { kind: "ask_admin"; href: string }
    /** Aún no hay pantalla (`ui_today` = nuevo): llega con los formularios de R3. */
    | { kind: "none" };

export interface PanelGap {
    id: string;
    title: string;
    level: ReadinessLevel;
    cause: string;
    message: string;
    intents: { id: string; title: string }[];
    /** Huecos que se resuelven al resolver este (causa raíz). */
    alsoFixes: { id: string; title: string }[];
    ratio?: { ok: number; total: number };
    action: GapAction;
}

export interface PanelArea {
    area: string;
    ok: number;
    total: number;
    pct: number;
}

export interface ReadinessPanelModel {
    verdict: ReadinessVerdict;
    evaluatedAt: string;
    specVersion: string;
    blocking: PanelGap[];
    necessary: PanelGap[];
    recommended: PanelGap[];
    /** Intenciones que quedarán en «no consta» mientras falten los necesarios. */
    limitedIntents: { id: string; title: string }[];
    quality: { id: string; title: string; message: string; action: GapAction }[];
    platform: { id: string; title: string; message: string }[];
    coverage: PanelArea[];
    recommendedPct: number;
    counts: ReadinessResultView["counts"];
}

const pct = (ok: number, total: number) => (total ? Math.round((ok / total) * 100) : 100);

/** Quién mira el panel: los enlaces se calculan con su permiso real (la misma tabla que la navegación). */
export interface PanelViewer {
    role: Role | null | undefined;
    impersonating: boolean;
}

/**
 * La ruta navegable de un `uiTarget`. Una ruta con segmento dinámico (`/admin/listings/[listingId]`) nombra la
 * ficha de un ítem; el panel no sabe cuál, así que enlaza al listado donde se elige.
 */
export function navigableTarget(uiTarget: string): string {
    const dynamic = uiTarget.search(/\/\[[^\]]+\]/);
    return dynamic >= 0 ? uiTarget.slice(0, dynamic) : uiTarget;
}

/** Enlace del hueco según el permiso real del rol. Nunca se ofrece un enlace que el guardia rechazaría. */
export function gapAction(uiTarget: string | null | undefined, viewer: PanelViewer): GapAction {
    if (!uiTarget) return { kind: "none" };
    const href = navigableTarget(uiTarget);
    const path = href.split(/[?#]/)[0];
    return canAccessPath(path, viewer.role, viewer.impersonating) ? { kind: "link", href } : { kind: "ask_admin", href };
}

export function buildReadinessPanel(response: ReadinessCurrentResponse, viewer: PanelViewer): ReadinessPanelModel {
    const r = response.result;
    const byId = new Map(r.requirements.map(req => [req.id, req]));
    // Un hueco que nace de otro se muestra una vez, en su raíz (schema §9).
    const shownAtRoot = (req: ReadinessRequirementView) => {
        const root = req.gap?.rootCause ? byId.get(req.gap.rootCause) : undefined;
        return Boolean(root?.gap);
    };
    const toGap = (id: string): PanelGap | null => {
        const req = byId.get(id);
        if (!req?.gap || shownAtRoot(req)) return null;
        return {
            id: req.id, title: req.title, level: req.level, cause: req.gap.cause, message: req.gap.message,
            intents: req.gap.intents,
            alsoFixes: req.gap.rootOf.map(child => ({ id: child, title: byId.get(child)?.title ?? child })),
            ...(req.ratio ? { ratio: req.ratio } : {}),
            action: gapAction(req.gap.uiTarget, viewer),
        };
    };
    const list = (ids: string[]) => ids.map(toGap).filter((g): g is PanelGap => g !== null);
    const coverage = Object.entries(r.coverage.byArea)
        .map(([area, c]) => ({ area, ok: c.ok, total: c.total, pct: pct(c.ok, c.total) }))
        .sort((a, b) => a.pct - b.pct || a.area.localeCompare(b.area));
    return {
        verdict: r.verdict,
        evaluatedAt: response.evaluatedAt,
        specVersion: r.specVersion,
        blocking: list(r.blockingGaps),
        necessary: list(r.necessaryGaps),
        recommended: list(r.recommendedGaps),
        limitedIntents: r.limitedIntents.map(({ id, title }) => ({ id, title })),
        quality: r.qualityWarnings.map(w => {
            const req = byId.get(w.id);
            return { id: w.id, title: req?.title ?? w.id, message: w.message, action: gapAction(w.uiTarget, viewer) };
        }),
        platform: r.platformGaps.map(p => ({ id: p.id, title: byId.get(p.id)?.title ?? p.id, message: p.message })),
        coverage,
        recommendedPct: r.coverage.r5Pct,
        counts: r.counts,
    };
}

/** Los primeros bloqueantes, para la tarjeta de Inicio (C0 §1.6: veredicto y 3 bloqueantes). */
export function topBlockingGaps(response: ReadinessCurrentResponse, viewer: PanelViewer, limit = 3): PanelGap[] {
    return buildReadinessPanel(response, viewer).blocking.slice(0, limit);
}
