"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Send, X } from "lucide-react";
import { CampaignCostNotice, type CampaignEstimate } from "./CampaignCostNotice";

/**
 * The step between "Enviar ahora" and four thousand charged deliveries.
 *
 * There was no step. One click on a green button launched the campaign, and the
 * only confirmation dialogue anywhere on the page was the one for picking an
 * A/B winner — a decision that costs nothing. Meta now charges the business's
 * own account per delivered message, so this is the moment a person is allowed
 * to change their mind.
 *
 * Keyboard: Escape closes, focus lands on Cancel rather than on Send so a
 * stray Return does not spend money, and focus is returned to whatever opened
 * the dialogue.
 */
export function CampaignSendConfirm({
    open, campaignName, recipients, estimate, busy, onConfirm, onCancel,
}: {
    open: boolean;
    campaignName: string;
    recipients: number | null;
    estimate?: CampaignEstimate | null;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const t = useTranslations("broadcast");
    const tc = useTranslations("common");
    const cancelRef = useRef<HTMLButtonElement | null>(null);
    const openerRef = useRef<Element | null>(null);

    useEffect(() => {
        if (!open) return;
        openerRef.current = document.activeElement;
        // The safe control, not the expensive one. A dialogue that opens with
        // "Send" focused turns an absent-minded Return into a purchase.
        cancelRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busy) onCancel();
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            (openerRef.current as HTMLElement | null)?.focus?.();
        };
    }, [open, busy, onCancel]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="campaign-send-confirm-title"
                className="w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-xl border border-border
                           bg-[var(--bg-secondary)] shadow-2xl"
            >
                <div className="flex items-start justify-between gap-3 px-6 pt-6">
                    <h3 id="campaign-send-confirm-title" className="text-base font-semibold text-foreground m-0">
                        {t("sendConfirmTitle", { name: campaignName })}
                    </h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        aria-label={tc("cancel")}
                        className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]
                                   transition-colors cursor-pointer bg-transparent border-none"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

                <div className="px-6 py-5">
                    <CampaignCostNotice recipients={recipients} estimate={estimate} />
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center
                                justify-end gap-3 px-6 pb-6">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className="px-4 py-2.5 rounded-lg border border-border bg-[var(--bg-tertiary)]
                                   text-foreground text-[13px] font-medium cursor-pointer
                                   hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        {tc("cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg
                                   border-none bg-emerald-500 text-white text-[13px] font-semibold
                                   cursor-pointer hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                        <Send size={14} aria-hidden />
                        {busy ? t("sendConfirmSending") : t("sendConfirmCta")}
                    </button>
                </div>
            </div>
        </div>
    );
}
