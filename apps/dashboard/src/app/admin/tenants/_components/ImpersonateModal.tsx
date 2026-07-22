"use client";

/**
 * Reason gate before entering a tenant's workspace.
 *
 * An act-as session nobody can justify afterwards is indistinguishable from an
 * intrusion, so the reason is required and structured (a picklist plus an
 * optional ticket) rather than free text — free text that is mandatory just
 * gets filled with noise.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, X, Loader2, AlertTriangle } from "lucide-react";

export const IMPERSONATION_REASONS = [
    "support_request",
    "incident",
    "billing",
    "onboarding",
    "other",
] as const;

export type ImpersonationReason = (typeof IMPERSONATION_REASONS)[number];

interface Props {
    tenantName: string;
    busy?: boolean;
    error?: string | null;
    onCancel: () => void;
    onConfirm: (access: { reason: string; ticketId?: string }) => void;
}

export default function ImpersonateModal({ tenantName, busy, error, onCancel, onConfirm }: Props) {
    const t = useTranslations("tenants");
    const tc = useTranslations("common");
    const [reason, setReason] = useState<ImpersonationReason>("support_request");
    const [notes, setNotes] = useState("");
    const [ticketId, setTicketId] = useState("");

    const needsNotes = reason === "other";
    const canSubmit = !busy && (!needsNotes || notes.trim().length >= 3);

    function handleConfirm() {
        if (!canSubmit) return;
        const label = t(`impersonation.reasons.${reason}`);
        onConfirm({
            reason: needsNotes ? `${label}: ${notes.trim()}` : label,
            ticketId: ticketId.trim() || undefined,
        });
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={busy ? undefined : onCancel}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
                            <Eye className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold">{t("impersonation.title")}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{tenantName}</p>
                        </div>
                    </div>
                    <button
                        onClick={onCancel}
                        disabled={busy}
                        className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>{t("impersonation.notice")}</span>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            {t("impersonation.reasonLabel")} <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={reason}
                            onChange={e => setReason(e.target.value as ImpersonationReason)}
                            disabled={busy}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 disabled:opacity-60"
                        >
                            {IMPERSONATION_REASONS.map(r => (
                                <option key={r} value={r}>{t(`impersonation.reasons.${r}`)}</option>
                            ))}
                        </select>
                    </div>

                    {needsNotes && (
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                {t("impersonation.notesLabel")} <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                autoFocus
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                disabled={busy}
                                placeholder={t("impersonation.notesPlaceholder")}
                                className="w-full bg-card border border-border rounded-lg px-3 py-2 disabled:opacity-60"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-1">{t("impersonation.ticketLabel")}</label>
                        <input
                            type="text"
                            value={ticketId}
                            onChange={e => setTicketId(e.target.value)}
                            disabled={busy}
                            placeholder={t("impersonation.ticketPlaceholder")}
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 disabled:opacity-60"
                        />
                    </div>

                    {error && <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded">{error}</p>}
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button
                        onClick={onCancel}
                        disabled={busy}
                        className="px-3 py-1.5 hover:bg-muted rounded-lg text-sm text-foreground border border-border disabled:opacity-50"
                    >
                        {tc("cancel")}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!canSubmit}
                        className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-600/40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2"
                    >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t("impersonation.confirm")}
                    </button>
                </div>
            </div>
        </div>
    );
}
