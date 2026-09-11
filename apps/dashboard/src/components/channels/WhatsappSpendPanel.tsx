"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Clock, Info, PauseCircle, Wallet } from "lucide-react";
import {
    allowanceRemaining, formatMinor, hasUnresolvedExposure,
    type WhatsappSpendSummary,
} from "@/lib/whatsapp-spend";

/**
 * What Meta is charging this business, shown inside the product that produces
 * the messages.
 *
 * Presentation only — the page fetches, this renders — so the whole panel can
 * be exercised with real numbers in a test instead of a loading state.
 *
 * ── THE ONE THING THIS SCREEN HAS TO GET ACROSS ─────────────────────────────
 *
 * That the charge is Meta's and not ours. From outside, the agent replying and
 * the bill arriving look like one product; a business owner who cannot see the
 * second inside the first concludes they are being charged twice. So the
 * explanation is not a tooltip or a help link — it is the first paragraph, and
 * it says whose money it is, where the card lives, and that the Parallly
 * subscription is separate and unchanged.
 */

export interface WhatsappReadinessNumber {
    channelAccountId: string;
    zone: string | null;
    resolution: { kind: string; zones?: readonly string[] };
    guidance: string;
    paused?: boolean;
}

export function WhatsappSpendPanel({ summary, readiness }: {
    summary: WhatsappSpendSummary | null;
    readiness?: readonly WhatsappReadinessNumber[];
}) {
    const t = useTranslations("whatsappSpend");
    const locale = useLocale();

    const allowance = allowanceRemaining(summary?.exposure ?? []);
    const unresolved = hasUnresolvedExposure(summary?.exposure ?? []);
    const pending = (readiness ?? []).filter(number => number.resolution.kind === "unmapped");
    const contradictory = (readiness ?? []).filter(number => number.resolution.kind === "contradictory");
    const paused = (readiness ?? []).filter(number => number.paused);

    return (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-5">
            <header className="flex items-start gap-3">
                <Wallet className="h-5 w-5 text-[var(--accent)] shrink-0 mt-0.5" aria-hidden />
                <div className="space-y-2">
                    <h2 className="text-[var(--text-primary)] text-base">{t("title")}</h2>
                    {/* Not a tooltip. Whose money this is has to be readable without
                        hovering anything, because the question it answers is the
                        one a person asks while looking at an unexpected invoice. */}
                    <p className="text-sm text-[var(--text-secondary)]">{t("whoCharges")}</p>
                </div>
            </header>

            {/* ── Anything stopping a send comes first ─────────────────────── */}
            {paused.length > 0 && (
                <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-4 space-y-2">
                    <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <PauseCircle className="h-4 w-4 text-[var(--danger)]" aria-hidden />
                        {t("paused")}
                    </p>
                    <p className="text-sm text-[var(--text-secondary)]">{t("pausedHint")}</p>
                    <ul className="space-y-1">
                        {paused.map(number => (
                            <li key={number.channelAccountId} className="text-sm text-[var(--text-secondary)]">
                                <span className="text-[var(--text-primary)]">{number.channelAccountId}</span>
                                {" — "}{number.guidance}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {contradictory.length > 0 && (
                <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4 space-y-1">
                    <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <AlertTriangle className="h-4 w-4 text-[var(--warning)]" aria-hidden />
                        {t("zoneContradiction")}
                    </p>
                    {contradictory.map(number => (
                        <p key={number.channelAccountId} className="text-sm text-[var(--text-secondary)]">
                            {number.guidance}
                        </p>
                    ))}
                </div>
            )}

            {pending.length > 0 && (
                <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4 space-y-1">
                    <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <Clock className="h-4 w-4 text-[var(--warning)]" aria-hidden />
                        {t("zoneMissing")}
                    </p>
                    {pending.map(number => (
                        <p key={number.channelAccountId} className="text-sm text-[var(--text-secondary)]">
                            <span className="text-[var(--text-primary)]">{number.channelAccountId}</span>
                            {" — "}{number.guidance}
                        </p>
                    ))}
                </div>
            )}

            {/* ── The free thousand ────────────────────────────────────────── */}
            <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-[var(--text-secondary)]">{t("freeAllowance")}</span>
                    <span className="text-sm text-[var(--text-primary)] tabular-nums">
                        {allowance.used} / {allowance.total}
                    </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                    <div
                        className="h-full bg-[var(--accent)]"
                        style={{ width: `${Math.round((allowance.used / allowance.total) * 100)}%` }}
                        role="progressbar"
                        aria-valuenow={allowance.used}
                        aria-valuemin={0}
                        aria-valuemax={allowance.total}
                    />
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                    {t("freeAllowanceHint", { used: allowance.used, total: allowance.total })}
                </p>
            </div>

            {/* ── What it cost, per currency, never summed ─────────────────── */}
            {!summary || summary.exposure.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">{t("noSpend")}</p>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-[var(--text-secondary)]">
                            {t("window", { days: summary.windowDays })}
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[var(--text-secondary)]">
                                    <th className="py-1 pr-4 font-normal">{t("settled")}</th>
                                    <th className="py-1 pr-4 font-normal">{t("reserved")}</th>
                                    <th className="py-1 pr-4 font-normal">{t("retained")}</th>
                                    <th className="py-1 pr-4 font-normal">{t("released")}</th>
                                    <th className="py-1 font-normal">{t("delivered")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summary.exposure.map(row => (
                                    <tr key={row.currency} className="text-[var(--text-primary)]">
                                        <td className="py-1 pr-4 tabular-nums">
                                            {formatMinor(row.settledMinor, row.currency, locale)}
                                        </td>
                                        <td className="py-1 pr-4 tabular-nums">
                                            {formatMinor(row.reservedMinor, row.currency, locale)}
                                        </td>
                                        <td className="py-1 pr-4 tabular-nums">
                                            {formatMinor(row.retainedMinor, row.currency, locale)}
                                        </td>
                                        <td className="py-1 pr-4 tabular-nums">
                                            {formatMinor(row.releasedMinor, row.currency, locale)}
                                        </td>
                                        <td className="py-1 tabular-nums">{row.chargedDeliveries}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">{t("perCurrency")}</p>
                    {unresolved && (
                        <p className="text-xs text-[var(--warning)]">{t("retainedHint")}</p>
                    )}
                </div>
            )}

            {/* ── Where it went ────────────────────────────────────────────── */}
            {summary && summary.signals.byCategory.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm text-[var(--text-primary)]">{t("byCategory")}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[var(--text-secondary)]">
                                    <th className="py-1 pr-4 font-normal">{t("category")}</th>
                                    <th className="py-1 pr-4 font-normal">{t("market")}</th>
                                    <th className="py-1 pr-4 font-normal">{t("settled")}</th>
                                    <th className="py-1 font-normal">{t("started")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summary.signals.byCategory.map(row => (
                                    <tr key={`${row.category}-${row.market}-${row.currency}`}
                                        className="text-[var(--text-primary)]">
                                        <td className="py-1 pr-4">{row.category}</td>
                                        <td className="py-1 pr-4">{row.market ?? "—"}</td>
                                        <td className="py-1 pr-4 tabular-nums">
                                            {formatMinor(row.settledMinor, row.currency, locale)}
                                        </td>
                                        <td className="py-1 tabular-nums">{row.proactive}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Contacts that only cost ──────────────────────────────────── */}
            {summary && summary.signals.costliestRecipients.some(row => row.reactive === 0 && row.proactive > 1) && (
                <div className="space-y-2">
                    <h3 className="text-sm text-[var(--text-primary)]">{t("costliestContacts")}</h3>
                    <ul className="space-y-1">
                        {summary.signals.costliestRecipients
                            .filter(row => row.reactive === 0 && row.proactive > 1)
                            .map(row => (
                                <li key={`${row.recipientRef}-${row.currency}`}
                                    className="text-sm text-[var(--text-secondary)]">
                                    <span className="text-[var(--text-primary)]">{row.recipientRef}</span>
                                    {" — "}{t("onlyCost", { count: row.proactive })}
                                </li>
                            ))}
                    </ul>
                    {/* Said out loud, because a list of "expensive contacts" reads as
                        a judgement about those people unless somebody says it is not. */}
                    <p className="text-xs text-[var(--text-secondary)]">{t("onlyCostHint")}</p>
                </div>
            )}

            {/* ── The refusal vocabulary, translated ───────────────────────── */}
            {summary && summary.refusalCodes.length > 0 && (
                <details className="rounded-lg border border-[var(--border)] p-3">
                    <summary className="cursor-pointer text-sm text-[var(--text-primary)] flex items-center gap-2">
                        <Info className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden />
                        {t("refusals")}
                    </summary>
                    <dl className="mt-3 space-y-2">
                        {summary.refusalCodes.map(code => (
                            <div key={code}>
                                <dt className="text-xs font-mono text-[var(--text-secondary)]">{code}</dt>
                                {/* A code the server knows and this build does not is
                                    shown as the code itself rather than as a blank
                                    line: an untranslated string during an outage is
                                    still information, and an empty one is not. */}
                                <dd className="text-sm text-[var(--text-primary)]">
                                    {t.has(`code.${code}`) ? t(`code.${code}`) : code}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </details>
            )}
        </section>
    );
}
