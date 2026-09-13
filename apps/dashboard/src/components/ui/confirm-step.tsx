"use client";

import { useEffect, useId, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The step between deciding and doing, for actions that cannot be undone.
 *
 * It says what will happen in this specific case rather than asking "are you
 * sure": an operator resolving a dispatch effect or publishing a configuration
 * is about to change what a real customer receives, and the sentence that
 * describes it is the whole safeguard.
 *
 * It deliberately does not take the alert-dialog role: this is inline and does
 * not trap focus, so claiming modal semantics would promise a behaviour that
 * is not there. It is a labelled group whose consequence is announced when it
 * appears, focus moves to the confirming button, and Escape cancels.
 */
export function ConfirmStep({ title, consequence, confirmLabel, cancelLabel, busy, tone = "caution", onConfirm, onCancel }: {
    title: string;
    consequence: string;
    confirmLabel: string;
    cancelLabel: string;
    busy: boolean;
    /** `danger` for an action that removes or stops something for everyone. */
    tone?: "caution" | "danger";
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const titleId = useId();
    const confirmRef = useRef<HTMLButtonElement>(null);
    useEffect(() => { confirmRef.current?.focus(); }, []);

    const button = "inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition "
        + "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 "
        + "focus-visible:ring-offset-2 focus-visible:ring-offset-background";

    return (
        <section
            role="group"
            aria-labelledby={titleId}
            onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onCancel(); } }}
            className={cn("mt-3 rounded-lg border p-4",
                tone === "danger"
                    ? "border-red-500/40 bg-red-500/10"
                    : "border-amber-500/40 bg-amber-500/10")}
        >
            <p id={titleId} className={cn("text-sm font-semibold",
                tone === "danger" ? "text-red-900 dark:text-red-100" : "text-amber-900 dark:text-amber-100")}>
                {title}
            </p>
            <p role="alert" className={cn("mt-1 text-sm",
                tone === "danger" ? "text-red-900/90 dark:text-red-100/90" : "text-amber-900/90 dark:text-amber-100/90")}>
                {consequence}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
                <button ref={confirmRef} type="button" disabled={busy} onClick={onConfirm}
                    className={cn(button, "text-white focus-visible:ring-indigo-500",
                        tone === "danger"
                            ? "border-red-600 bg-red-600 hover:bg-red-700"
                            : "border-amber-600 bg-amber-600 hover:bg-amber-700")}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {confirmLabel}
                </button>
                <button type="button" disabled={busy} onClick={onCancel}
                    className={cn(button, "border-border bg-card text-foreground hover:bg-muted focus-visible:ring-indigo-500")}>
                    {cancelLabel}
                </button>
            </div>
        </section>
    );
}
