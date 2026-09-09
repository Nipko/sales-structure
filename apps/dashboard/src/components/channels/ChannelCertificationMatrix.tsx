"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import type { AgentOperationalState } from "@parallext/shared";
import { OperationalStateBadge, OperationalStateLegend } from "@/components/quality/OperationalState";

/**
 * What each channel can be said to do, rendered from the API's own matrix.
 *
 * Presentation only, and separate from the page on purpose: the page fetches and
 * this takes the answer, so the table can be rendered in a test with real data
 * instead of a loading state. The six-state vocabulary comes from
 * `OperationalStateBadge` rather than a second switch here — a second switch is
 * how two surfaces come to disagree about what `prepared` looks like.
 *
 * Three columns of summary because they are three questions. `implemented` says
 * nothing is missing; `operating` says it was seen working; `certified` says a
 * run proved it, with a revision and a date. A capability that is only DECLARED
 * is none of the three, and it appears under "declared, never operated" — the
 * list that used to be invisible, because the old summary counted a row with
 * nothing in state `pending` and a declaration is `prepared`, not `pending`.
 */

export type CapabilityBasis = "derived" | "declared" | "out_of_scope";

export interface CapabilityProof {
    kind: "suite" | "pilot";
    source: string;
    revision: string;
    recordedAt: string;
}

export interface CapabilityCell {
    capability: string;
    state: AgentOperationalState;
    basis: CapabilityBasis;
    evidence: string;
    proof: CapabilityProof | null;
}

export interface ChannelRow {
    channelType: string;
    selfService: boolean;
    retainedScope: string | null;
    state: AgentOperationalState;
    capabilities: CapabilityCell[];
    pending: string[];
    untested: string[];
    unproven: string[];
    certified: boolean;
}

export interface ChannelCertificationSummary {
    channels: number;
    selfService: number;
    retained: number;
    implemented: number;
    operating: number;
    certified: number;
    pendingByCapability: Record<string, string[]>;
    untestedByCapability: Record<string, string[]>;
    unprovenByCapability: Record<string, string[]>;
}

export function ChannelCertificationMatrix(
    { rows, summary }: { rows: ChannelRow[]; summary: ChannelCertificationSummary | null },
) {
    const t = useTranslations("channelCertification");
    const capabilities = rows[0]?.capabilities.map(cell => cell.capability) ?? [];
    const label = (key: string) => (t.has(`capabilities.${key}`) ? t(`capabilities.${key}`) : key);

    return (
        <div className="space-y-6">
            {summary && (
                <section aria-label={t("summary.title")} className="grid gap-4 sm:grid-cols-3">
                    {([
                        ["implemented", summary.implemented],
                        ["operating", summary.operating],
                        ["certified", summary.certified],
                    ] as const).map(([key, value]) => (
                        <div key={key} className="rounded-lg border border-border p-4">
                            <p className="text-sm text-muted-foreground">{t(`summary.${key}`)}</p>
                            <p className="mt-1 text-2xl text-foreground">
                                {value}
                                <span className="ml-1 text-base text-muted-foreground">/ {summary.selfService}</span>
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">{t(`summary.${key}Meaning`)}</p>
                        </div>
                    ))}
                </section>
            )}

            <OperationalStateLegend states={rows.flatMap(row => row.capabilities.map(cell => cell.state))} />

            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-[820px] w-full text-sm">
                    <caption className="sr-only">{t("tableCaption")}</caption>
                    <thead className="sticky top-0 bg-muted/60">
                        <tr>
                            <th scope="col" className="p-3 text-left font-normal text-muted-foreground">{t("channel")}</th>
                            {capabilities.map(capability => (
                                <th key={capability} scope="col" className="p-3 text-left font-normal text-muted-foreground">
                                    {label(capability)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.channelType} className="border-t border-border align-top">
                                <th scope="row" className="p-3 text-left font-normal text-foreground">
                                    <span className="flex items-center gap-2">
                                        {row.channelType}
                                        {row.certified && <ShieldCheck className="h-4 w-4" aria-label={t("certifiedRow")} />}
                                    </span>
                                    {!row.selfService && (
                                        <span className="mt-1 block text-xs text-muted-foreground">
                                            {row.retainedScope ?? t("outOfScope")}
                                        </span>
                                    )}
                                </th>
                                {row.capabilities.map(cell => (
                                    <td key={cell.capability} className="p-3">
                                        <OperationalStateBadge state={cell.state} />
                                        <span className="mt-1 block text-xs text-muted-foreground">
                                            {t(`basis.${cell.basis}`)}
                                        </span>
                                        {/* A pointer, and — when one exists — the run that proved it.
                                            Prose cannot say when, or against which revision. */}
                                        <span className="mt-1 block text-xs text-muted-foreground">
                                            {cell.proof
                                                ? `${cell.proof.source} · ${cell.proof.revision.slice(0, 8)} · ${cell.proof.recordedAt.slice(0, 10)}`
                                                : t("noProof")}
                                        </span>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {summary && (
                <section aria-label={t("gaps.title")} className="space-y-4">
                    <h2 className="text-lg text-foreground">{t("gaps.title")}</h2>
                    {([
                        ["pending", summary.pendingByCapability],
                        ["untested", summary.untestedByCapability],
                        ["unproven", summary.unprovenByCapability],
                    ] as const).map(([key, index]) => (
                        <div key={key} className="rounded-lg border border-border p-4">
                            <h3 className="text-sm text-foreground">{t(`gaps.${key}`)}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">{t(`gaps.${key}Meaning`)}</p>
                            {Object.keys(index).length === 0 ? (
                                <p className="mt-2 text-sm text-muted-foreground">{t("gaps.none")}</p>
                            ) : (
                                <ul className="mt-2 space-y-1 text-sm text-foreground">
                                    {Object.entries(index).map(([capability, channels]) => (
                                        <li key={capability}>
                                            <span className="text-muted-foreground">{label(capability)}:</span>{" "}
                                            {channels.join(", ")}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
}
