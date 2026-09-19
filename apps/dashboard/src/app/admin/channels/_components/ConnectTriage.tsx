"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type TriageAnswer = "yes" | "no" | "unsure";

const TRIAGE_ANSWERS: readonly TriageAnswer[] = ["yes", "no", "unsure"];

/**
 * The one question asked BEFORE Meta's window opens.
 *
 * In the recording the owner walked into Meta's wall and came back out with a
 * refusal she could not act on. The single thing that would have saved those
 * minutes is a question she could answer in two seconds — is the account
 * professional / can you post as the page — with the fix printed underneath.
 *
 * Two rules it must not break:
 *
 * - It NEVER blocks. Nothing here can be verified from our side before the
 *   person signs in, so an answer is a hint, not a gate; the connect button
 *   stays exactly as available as it was. "No sé" is a first-class answer for
 *   the same reason, and it shows the same steps as "No" — the steps are how
 *   you find out.
 * - It remembers nothing. The answer is component state and dies with the page:
 *   it is a self-declaration, and storing it would turn a hint into a record we
 *   would then be tempted to trust.
 *
 * `namespace` points at `channels.<channel>.triage`, so each channel asks its
 * own question with its own three steps and this component stays channel-free.
 */
export function ConnectTriage({ namespace, name }: { namespace: string; name: string }) {
    const t = useTranslations(namespace);
    const [answer, setAnswer] = useState<TriageAnswer | null>(null);
    const steps = t.raw("steps") as string[];
    const showSteps = answer === "no" || answer === "unsure";

    return (
        <div className="mb-5 rounded-xl border border-border bg-[var(--bg-tertiary)] p-4">
            <fieldset className="m-0 border-0 p-0">
                <legend className="p-0 text-[13px] font-semibold text-foreground">{t("question")}</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                    {TRIAGE_ANSWERS.map((option) => (
                        <label key={option} className="cursor-pointer">
                            <input
                                type="radio"
                                name={name}
                                value={option}
                                checked={answer === option}
                                onChange={() => setAnswer(option)}
                                className="peer sr-only"
                            />
                            <span
                                className={cn(
                                    "inline-flex items-center rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                                    "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-1",
                                    answer === option
                                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-foreground"
                                        : "border-border bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-foreground"
                                )}
                            >
                                {t(option)}
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            {answer === "yes" && (
                <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--success)]">
                    <CheckCircle2 size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                    {t("ready")}
                </p>
            )}

            {showSteps && (
                <div className="mt-3">
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                        <HelpCircle size={14} aria-hidden="true" className="shrink-0" />
                        {t("stepsTitle")}
                    </p>
                    <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                        {steps.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ol>
                    <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                        {t("alwaysAvailable")}
                    </p>
                </div>
            )}
        </div>
    );
}
