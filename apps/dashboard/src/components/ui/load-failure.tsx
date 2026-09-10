"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * "We could not read this" — said out loud, where the answer would have been.
 *
 * Almost every admin screen loaded its data inside a `try` whose `catch` only
 * reached `console.error`, leaving the initial `[]` / `null` / `false` on
 * screen. The operator then read a settled fact about their own account —
 * "Desconectado", "no tienes agentes", "sin bajas de consentimiento" — from a
 * request that never came back. Empty and unreadable are different answers and
 * have to look different.
 *
 * Deliberately dumb: a notice plus the one action that can help. It carries no
 * state of its own so a page can render it above whatever it managed to read,
 * and `role="alert"` so a screen reader hears it when it appears.
 */
export function LoadFailureNotice({
    onRetry,
    title,
    hint,
    className,
}: {
    /** Omitted only when the screen has no way to re-run the read. */
    onRetry?: () => void;
    /** Overrides for a screen that can name what it failed to read. */
    title?: string;
    hint?: string;
    className?: string;
}) {
    const t = useTranslations("common");
    return (
        <div
            role="alert"
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-[rgba(255,170,0,0.25)] bg-[rgba(255,170,0,0.08)] p-4 sm:flex-row sm:items-center",
                className,
            )}
        >
            <AlertCircle size={18} className="shrink-0 text-[var(--warning)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold text-foreground">{title ?? t("loadFailed")}</p>
                <p className="m-0 mt-0.5 text-xs text-[var(--text-secondary)]">{hint ?? t("loadFailedHint")}</p>
            </div>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                    <RotateCw size={14} aria-hidden="true" /> {t("retry")}
                </button>
            )}
        </div>
    );
}
