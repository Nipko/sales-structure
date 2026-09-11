"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Clock, HelpCircle, Info, PauseCircle, Wallet } from "lucide-react";
import {
    deliveryReadiness, formatMinor, fundingFromPause, fundingIsActionable,
    hasUnresolvedExposure, latestMonthPerNumber, pausesWorthShowing, undatedConsumption,
    type WhatsappConsumption, type WhatsappNumberPause, type WhatsappSpendSummary,
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
 *
 * ── AND THE THING IT MUST NOT DO ────────────────────────────────────────────
 *
 * Add two currencies. Every money figure below is rendered beside its own
 * currency code and never against another; a row in pesos and a row in dollars
 * are two rows, and there is no line at the bottom.
 */

export interface WhatsappReadinessNumber {
    channelAccountId: string;
    zone: string | null;
    resolution: { kind: string; zones?: readonly string[] };
    guidance: string;
    /**
     * Both halves of "can this number price anything": the zone dates the rate,
     * the currency chooses the card.
     *
     * There is deliberately no `paused` here. This shape comes from
     * `GET /whatsapp/connection/billing-readiness`, which is about the billing
     * TIME ZONE and returns no such field — the panel used to filter on one
     * anyway, so the pause block never rendered and the number that had stopped
     * sending looked healthy. Pause state has its own endpoint and its own
     * prop.
     */
    currency?: string | null;
    currencyStale?: boolean;
    currencyGuidance?: string;
}

/** Effects that outlived the grace period with no answer from the provider. */
export interface WhatsappAwaitingResolution {
    graceHours: number;
    effects: ReadonlyArray<{ effectKey: string }>;
}

export function WhatsappSpendPanel({ summary, consumption, pauses, readiness, awaiting, onResume }: {
    summary: WhatsappSpendSummary | null;
    /** Per number per WABA-local calendar month: the period the invoice uses. */
    consumption?: WhatsappConsumption | null;
    /** Which numbers Meta will not bill, and which ones we could not ask about. */
    pauses?: readonly WhatsappNumberPause[];
    readiness?: readonly WhatsappReadinessNumber[];
    awaiting?: WhatsappAwaitingResolution | null;
    /**
     * Let an admin say they fixed the payment method.
     *
     * Absent for a supervisor, who may READ that a number is paused and may not
     * resume it: resuming is a decision about the business's own billing. Absent
     * also means the button does not render at all, rather than rendering and
     * failing — a control that refuses after being pressed teaches people that
     * the screen is broken.
     */
    onResume?: (channelAccountId: string) => Promise<void> | void;
}) {
    const t = useTranslations("whatsappSpend");
    const locale = useLocale();

    const unresolved = hasUnresolvedExposure(summary?.exposure ?? []);
    const pending = (readiness ?? []).filter(number => number.resolution.kind === "unmapped");
    const contradictory = (readiness ?? []).filter(number => number.resolution.kind === "contradictory");
    /**
     * ── FUNDING READINESS, DERIVED RATHER THAN RESTATED ─────────────────────
     *
     * The engine has three answers about whether a number can keep delivering,
     * and the screen uses the same function rather than a second opinion:
     *
     *   · `not_ready` (Meta refused to bill) is the ONLY one a person is asked
     *     to act on, and it gets the block at the top;
     *   · `unestablished` covers both "we could not read the state" and "nobody
     *     has established anything". The second is every healthy number, and it
     *     produces NOTHING on screen — the thing to do about it is ask again,
     *     which is the system's job. Putting it in front of somebody is how a
     *     warning becomes noise and the real one gets ignored. Only the first
     *     is shown, because while it holds nothing is being sent;
     *   · `ready` cannot be produced from this data at all, so no green tick is
     *     rendered for funding anywhere. That is the honest outcome regardless:
     *     `attached` is not solvency, and a card can be attached and declined.
     */
    const attention = pausesWorthShowing(pauses);
    const stopped = attention.filter(number => fundingIsActionable(fundingFromPause(number)));
    const unreadable = attention.filter(number =>
        deliveryReadiness(fundingFromPause(number)) === "unestablished" && number.stateUnknown);
    const months = latestMonthPerNumber(consumption);
    const undated = undatedConsumption(consumption);

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
            {stopped.length > 0 && (
                <div role="alert"
                    className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-4 space-y-2">
                    <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <PauseCircle className="h-4 w-4 text-[var(--danger)]" aria-hidden />
                        {/* The word "pausado" carries the state, so the red does not
                            have to. A person who cannot see the colour reads the
                            same fact in the same place. */}
                        {t("paused")}
                    </p>
                    <p className="text-sm text-[var(--text-secondary)]">{t("pausedHint")}</p>
                    <ul className="space-y-2">
                        {stopped.map(number => (
                            <li key={number.channelAccountId}
                                className="text-sm text-[var(--text-secondary)] flex flex-wrap items-center gap-2">
                                <span>
                                    <span className="text-[var(--text-primary)]">
                                        {number.displayName ?? number.channelAccountId}
                                    </span>
                                    {number.explanation ? " — " : ""}{number.explanation ?? ""}
                                </span>
                                {/* ── THE WAY OUT THAT NEEDS NO SEND ──────────────
                                    A pause lifts by itself when Meta accepts a
                                    message. A paused number sends nothing, so
                                    that proof can never arrive on its own: without
                                    this button the only exit would be the POST the
                                    pause itself prevents. */}
                                {onResume && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!window.confirm(t("resumeConfirm"))) return;
                                            void onResume(number.channelAccountId);
                                        }}
                                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs
                                                   text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]
                                                   focus-visible:outline focus-visible:outline-2
                                                   focus-visible:outline-offset-2"
                                    >
                                        {t("resume")}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* ── "We could not find out" is not "it is running" ───────────── */}
            {unreadable.length > 0 && (
                <div role="alert"
                    className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4 space-y-2">
                    <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <HelpCircle className="h-4 w-4 text-[var(--warning)]" aria-hidden />
                        {t("pauseUnknown")}
                    </p>
                    <p className="text-sm text-[var(--text-secondary)]">{t("pauseUnknownHint")}</p>
                    <ul className="space-y-1">
                        {unreadable.map(number => (
                            <li key={number.channelAccountId} className="text-sm text-[var(--text-secondary)]">
                                <span className="text-[var(--text-primary)]">
                                    {number.displayName ?? number.channelAccountId}
                                </span>
                                {number.explanation ? " — " : ""}{number.explanation ?? ""}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* ── What nobody can decide without a person ──────────────────── */}
            {awaiting && awaiting.effects.length > 0 && (
                <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4 space-y-1">
                    <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                        <AlertTriangle className="h-4 w-4 text-[var(--warning)]" aria-hidden />
                        {t("awaitingResolution")}
                    </p>
                    <p className="text-sm text-[var(--text-secondary)]">
                        {t("awaitingResolutionHint", {
                            count: awaiting.effects.length, hours: awaiting.graceHours,
                        })}
                    </p>
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

            {/* ══ THIS CALENDAR MONTH, PER NUMBER ══════════════════════════════
                The period Meta invoices and the period the free allowance
                resets in — both counted in the WhatsApp account's own time
                zone, and both per NUMBER. The rolling window below answers a
                different question and is kept visibly separate from this one. */}
            <div className="space-y-3" aria-live="polite">
                <h3 className="text-sm text-[var(--text-primary)]">{t("thisMonth")}</h3>
                {months.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)]">{t("noMonth")}</p>
                ) : (
                    <ul className="space-y-4">
                        {months.map(number => {
                            const used = Math.min(number.freeDeliveries, number.allowance);
                            const percent = number.allowance > 0
                                ? Math.round((used / number.allowance) * 100) : 0;
                            return (
                                <li key={number.channelAccountId} className="space-y-2">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span className="text-sm text-[var(--text-primary)]">
                                            {number.channelAccountId}
                                        </span>
                                        <span className="text-xs text-[var(--text-secondary)]">
                                            {t("monthLabel", { month: number.month })}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="text-sm text-[var(--text-secondary)]">
                                            {t("freeAllowance")}
                                        </span>
                                        <span className="text-sm text-[var(--text-primary)] tabular-nums">
                                            {number.freeDeliveries} / {number.allowance}
                                        </span>
                                    </div>
                                    <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                                        <div
                                            className="h-full bg-[var(--accent)]"
                                            style={{ width: percent + "%" }}
                                            role="progressbar"
                                            aria-label={t("allowanceProgressLabel", {
                                                number: number.channelAccountId,
                                            })}
                                            aria-valuenow={used}
                                            aria-valuemin={0}
                                            aria-valuemax={number.allowance}
                                        />
                                    </div>
                                    <p className="text-xs text-[var(--text-secondary)]">
                                        {t("freeAllowanceHint", {
                                            used: number.freeDeliveries, total: number.allowance,
                                        })}
                                    </p>
                                    <p className="text-sm text-[var(--text-secondary)]">
                                        {t("chargedThisMonth", { count: number.chargedDeliveries })}
                                    </p>
                                    {/* One line per currency, and no line under them.
                                        Two accounts in two currencies are two totals;
                                        adding them would need a rate nobody agreed to. */}
                                    <ul className="space-y-1">
                                        {number.money.map(money => (
                                            <li key={money.currency}
                                                className="flex flex-wrap items-baseline justify-between gap-3
                                                           text-sm text-[var(--text-secondary)]">
                                                <span>{t("settled")} · {money.currency}</span>
                                                <span className="text-[var(--text-primary)] tabular-nums">
                                                    {formatMinor(money.settledMinor, money.currency, locale)}
                                                    {money.retainedMinor > 0 && (
                                                        <>
                                                            {" · "}{t("retained")}{" "}
                                                            {formatMinor(money.retainedMinor, money.currency, locale)}
                                                        </>
                                                    )}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {/* A ceiling, and every figure above it, bounds only what Parallly
                    sent. The same WhatsApp account can be charged by another app
                    or by a person using Meta's own inbox, so this must not be read
                    as the whole bill. */}
                <p className="text-xs text-[var(--text-secondary)]">{t("onlyWhatWeSent")}</p>
                {undated.length > 0 && (
                    <p className="text-xs text-[var(--warning)]">
                        {t("undated", { count: undated.length })}
                    </p>
                )}
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
                            <caption className="sr-only">{t("exposureCaption")}</caption>
                            <thead>
                                <tr className="text-left text-[var(--text-secondary)]">
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("currency")}</th>
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("settled")}</th>
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("reserved")}</th>
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("retained")}</th>
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("released")}</th>
                                    <th scope="col" className="py-1 font-normal">{t("delivered")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summary.exposure.map(row => (
                                    <tr key={row.currency} className="text-[var(--text-primary)]">
                                        {/* The currency in its own cell rather than only
                                            inside each formatted amount: a reader
                                            scanning the row has to be able to see which
                                            money this line is, and a screen reader has
                                            to be able to announce it once. */}
                                        <th scope="row" className="py-1 pr-4 font-normal">{row.currency}</th>
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
                            <caption className="sr-only">{t("byCategory")}</caption>
                            <thead>
                                <tr className="text-left text-[var(--text-secondary)]">
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("category")}</th>
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("market")}</th>
                                    <th scope="col" className="py-1 pr-4 font-normal">{t("settled")}</th>
                                    <th scope="col" className="py-1 font-normal">{t("started")}</th>
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
