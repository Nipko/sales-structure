"use client";

/**
 * Super_admin UI to publish a platform-wide maintenance message. The
 * message is shown as a banner across every dashboard tab. Severity
 * controls color intensity; severity=critical should be reserved for
 * active incidents that block functionality.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { LoadFailureNotice } from "@/components/ui/load-failure";
import { cn } from "@/lib/utils";
import {
    AlertTriangle, Save, Loader2, CheckCircle, Megaphone, X, Eye,
    Info, AlertOctagon,
} from "lucide-react";

const SEVERITY_OPTIONS = [
    { value: "info" as const, labelKey: "severityInfo", icon: Info, color: "text-blue-600", bg: "bg-blue-500/10" },
    { value: "warning" as const, labelKey: "severityWarning", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-500/10" },
    { value: "critical" as const, labelKey: "severityCritical", icon: AlertOctagon, color: "text-red-600", bg: "bg-red-500/10" },
];

export default function MaintenanceModeCard() {
    const t = useTranslations("maintenanceMode");
    const tc = useTranslations("common");

    const [enabled, setEnabled] = useState(false);
    const [message, setMessage] = useState("");
    const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");
    const [expiresAt, setExpiresAt] = useState("");
    const [setBy, setSetBy] = useState<string | null>(null);
    const [setAt, setSetAt] = useState<string | null>(null);
    /**
     * Whether we actually know what is published.
     *
     * The load used to swallow every rejection and fall through with the
     * initial state, which is `enabled = false` and an empty message. So a
     * dropped request drew this card exactly like a platform with no banner
     * up — an operator checking during an incident reads "no banner" and
     * concludes the announcement never went out, or that the platform is
     * serving normally. Worse, the Save button below writes what is on screen:
     * one click on a card that never loaded silently clears a live incident
     * notice for every tenant.
     *
     * `unavailable` is therefore not cosmetic. Nothing here may be published
     * from a state we did not read.
     */
    const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const load = useCallback(async () => {
        setStatus("loading");
        try {
            const res = await api.getPlatformMaintenance();
            // `success: false` is a failed read too. It used to fall through
            // the same `if` and leave the defaults standing.
            if (!res.success || !res.data) throw new Error("maintenance_read_failed");
            setEnabled(!!res.data.enabled);
            setMessage(res.data.message || "");
            setSeverity(res.data.severity || "info");
            setExpiresAt(res.data.expiresAt
                ? new Date(res.data.expiresAt).toISOString().slice(0, 16)
                : "");
            setSetBy(res.data.setBy || null);
            setSetAt(res.data.setAt || null);
            setStatus("ready");
        } catch {
            setStatus("unavailable");
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const unavailable = status === "unavailable";
    const loading = status === "loading";

    async function handleSave() {
        // The editor is not rendered while the state is unknown, but the
        // handler refuses too: a Save that writes fields nobody read is the
        // failure this card was found in, not a rendering detail.
        if (status !== "ready") return;
        if (enabled && !message.trim()) {
            setFeedback({ type: "error", text: t("messageRequired") });
            return;
        }
        setSaving(true);
        setFeedback(null);
        try {
            const res = await api.setPlatformMaintenance({
                enabled,
                message: message.trim(),
                severity,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
            });
            if (res.success) {
                setFeedback({ type: "success", text: enabled ? t("publishedSuccess") : t("clearedSuccess") });
                setSetBy(res.data?.setBy || null);
                setSetAt(res.data?.setAt || null);
            } else {
                setFeedback({ type: "error", text: res.error || tc("connectionError") });
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setSaving(false);
        }
    }

    async function handleClear() {
        if (status !== "ready") return;
        setEnabled(false);
        setMessage("");
        setExpiresAt("");
        setSaving(true);
        setFeedback(null);
        try {
            const res = await api.setPlatformMaintenance({
                enabled: false,
                message: "",
                severity: "info",
                expiresAt: null,
            });
            if (res.success) {
                setFeedback({ type: "success", text: t("clearedSuccess") });
                setSetBy(null);
                setSetAt(null);
            }
        } catch (e: any) {
            setFeedback({ type: "error", text: e?.message || tc("connectionError") });
        } finally {
            setSaving(false);
        }
    }

    const SeverityIcon = SEVERITY_OPTIONS.find(s => s.value === severity)?.icon || Info;

    return (
        <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 overflow-hidden">
            <div className="p-5 border-b border-neutral-200 dark:border-neutral-800">
                <h2 className="text-base font-semibold flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-amber-500" />
                    {t("title")}
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">{t("description")}</p>
            </div>

            <div className="p-5 space-y-5">
                {/* Not "no banner is published": we do not know what is
                    published. The editor stays out of the way entirely, so
                    there is nothing here to press that could overwrite a live
                    announcement with the state of a request that failed. */}
                {unavailable && (
                    <LoadFailureNotice
                        title={t("stateUnknown")}
                        hint={t("stateUnknownHint")}
                        onRetry={() => { void load(); }}
                    />
                )}

                {!unavailable && (<>
                {/* Enable toggle */}
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-sm font-medium">{t("enabledLabel")}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("enabledHelp")}</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setEnabled(!enabled)}
                        className={cn(
                            "relative h-6 w-11 rounded-full transition-colors flex-shrink-0",
                            enabled ? "bg-amber-500" : "bg-neutral-300 dark:bg-neutral-600",
                        )}
                    >
                        <div className={cn(
                            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left]",
                            enabled ? "left-[26px]" : "left-[3px]",
                        )} />
                    </button>
                </div>

                {/* Severity selector */}
                <div>
                    <label className="block text-sm font-medium mb-2">{t("severityLabel")}</label>
                    <div className="grid grid-cols-3 gap-2">
                        {SEVERITY_OPTIONS.map(opt => {
                            const Icon = opt.icon;
                            const active = severity === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => setSeverity(opt.value)}
                                    className={cn(
                                        "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition",
                                        active
                                            ? `${opt.bg} border-current ${opt.color} font-semibold`
                                            : "bg-card border-border hover:bg-muted text-neutral-600 dark:text-neutral-400",
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {t(opt.labelKey as any)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Message */}
                <div>
                    <label className="block text-sm font-medium mb-1">{t("messageLabel")}</label>
                    <textarea
                        value={message}
                        onChange={e => setMessage(e.target.value.slice(0, 500))}
                        rows={3}
                        placeholder={t("messagePlaceholder")}
                        className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                        {t("messageHelp", { count: message.length })}
                    </p>
                </div>

                {/* Expires at */}
                <div>
                    <label className="block text-sm font-medium mb-1">{t("expiresLabel")}</label>
                    <input
                        type="datetime-local"
                        value={expiresAt}
                        onChange={e => setExpiresAt(e.target.value)}
                        className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{t("expiresHelp")}</p>
                </div>

                {/* Live preview */}
                {message && (
                    <div>
                        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1.5 flex items-center gap-1">
                            <Eye className="h-3 w-3" /> {t("preview")}
                        </div>
                        <div className={cn(
                            "rounded-lg px-3 py-2 flex items-start gap-2 text-sm",
                            severity === "critical" && "bg-red-600 text-white",
                            severity === "warning" && "bg-amber-500 text-neutral-900",
                            severity === "info" && "bg-blue-600 text-white",
                        )}>
                            <SeverityIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <span className="font-medium">{message}</span>
                        </div>
                    </div>
                )}

                {feedback && (
                    <div className={cn(
                        "rounded-lg px-3 py-2 text-sm border flex items-start gap-2",
                        feedback.type === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
                        feedback.type === "error" && "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
                    )}>
                        {feedback.type === "success" ? <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
                        <span>{feedback.text}</span>
                    </div>
                )}

                {/* Last set info */}
                {setAt && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 italic border-t border-neutral-200 dark:border-neutral-800 pt-3">
                        {t("lastSet", { who: setBy || "—", when: new Date(setAt).toLocaleString() })}
                    </p>
                )}

                {/* Action buttons */}
                <div className="flex justify-end gap-2 pt-2">
                    {enabled && setAt && (
                        <button
                            onClick={handleClear}
                            disabled={saving || loading}
                            className="px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-50"
                        >
                            <X className="h-4 w-4" /> {t("clear")}
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium text-white inline-flex items-center gap-2 disabled:opacity-60 transition",
                            enabled ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700",
                        )}
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {enabled ? t("publish") : t("save")}
                    </button>
                </div>
                </>)}
            </div>
        </div>
    );
}
