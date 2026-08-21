"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock, KeyRound, ShieldAlert } from "lucide-react";

/**
 * Lo que el backend ya sabía y la pantalla no mostraba.
 *
 * `materializeIntegrationHealth` calcula desde hace un release si la credencial
 * fue validada, qué permisos concedió el proveedor de los que hacen falta, y de
 * cuándo es el último dato traído. Nada de eso llegaba al dueño: veía
 * "Conectado" o nada. Una integración con el token vencido, con la mitad de los
 * permisos o sincronizada hace tres días se veía exactamente igual que una
 * sana, y el dueño se enteraba por un cliente que preguntó por un horario que
 * no existía.
 */

export interface IntegrationHealth {
    status: "healthy" | "stale" | "degraded" | "unhealthy" | "unavailable";
    connected: boolean;
    credentialValidated: boolean;
    requiredScopes: string[];
    grantedScopes: string[];
    scopeStatus: "unknown" | "satisfied" | "missing" | "not_applicable";
    lastCheckedAt: string | null;
    lastSuccessfulSyncAt: string | null;
    freshness: { maxAgeSeconds: number; ageSeconds: number | null; stale: boolean };
    consecutiveFailures: number;
    circuitState: "closed" | "open" | "half_open";
    lastError: { code: string; message: string; at: string } | null;
}

const STATUS_STYLE: Record<IntegrationHealth["status"], string> = {
    healthy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    stale: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    degraded: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    unhealthy: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
    unavailable: "bg-muted text-muted-foreground",
};

function ageLabel(seconds: number | null, t: ReturnType<typeof useTranslations>): string {
    if (seconds === null) return t("neverSynced");
    if (seconds < 90) return t("ageSeconds", { count: seconds });
    if (seconds < 5400) return t("ageMinutes", { count: Math.round(seconds / 60) });
    if (seconds < 172800) return t("ageHours", { count: Math.round(seconds / 3600) });
    return t("ageDays", { count: Math.round(seconds / 86400) });
}

export function IntegrationHealthPanel({ health }: { health?: IntegrationHealth | null }) {
    const t = useTranslations("verticalIntegrations.health");
    if (!health) return null;

    const missingScopes = health.requiredScopes.filter((s) => !health.grantedScopes.includes(s));

    return (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full font-medium",
                    STATUS_STYLE[health.status],
                )}>
                    {t(`status_${health.status}`)}
                </span>

                {/* Guardar una credencial no es haberla validado. Sin esto, el
                    dueño leía "guardado" como "funciona". */}
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <KeyRound size={12} />
                    {health.credentialValidated ? t("credentialValidated") : t("credentialUnverified")}
                </span>

                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock size={12} />
                    {t("lastSync", { age: ageLabel(health.freshness.ageSeconds, t) })}
                </span>
            </div>

            {/* Un token con la mitad de los permisos está conectado igual, y la
                lectura vuelve vacía sin decir por qué. */}
            {missingScopes.length > 0 && (
                <div className="flex items-start gap-2 text-[11px] text-red-600 dark:text-red-400">
                    <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                    <span>{t("scopesMissing", { scopes: missingScopes.join(", ") })}</span>
                </div>
            )}
            {missingScopes.length === 0 && health.scopeStatus === "unknown" && (
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                    <span>{t("scopesUnknown")}</span>
                </div>
            )}
            {health.scopeStatus === "satisfied" && (
                <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                    <span>{t("scopesSatisfied", { scopes: health.grantedScopes.join(", ") })}</span>
                </div>
            )}

            {health.lastError && (
                <div className="flex items-start gap-2 text-[11px] text-red-600 dark:text-red-400">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{t("lastError", { code: health.lastError.code })}</span>
                </div>
            )}

            {/* El circuito abierto explica por qué el agente dejó de usarla sin
                que nadie desconectara nada. */}
            {health.circuitState !== "closed" && (
                <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{t(`circuit_${health.circuitState}`)}</span>
                </div>
            )}
        </div>
    );
}
