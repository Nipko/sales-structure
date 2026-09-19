"use client";

import Link from "next/link";
import { BookOpenText, MessagesSquare, FlaskConical, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

const PATHS = [
    { key: "knowledge", icon: BookOpenText, href: () => "/admin/knowledge" },
    { key: "learning", icon: MessagesSquare, href: (agentId: string) => `/admin/agent/${agentId}/learning` },
    { key: "simulation", icon: FlaskConical, href: () => "/admin/agent/simulation" },
] as const;

/**
 * Optional ways to improve the agent after its first useful answer.
 *
 * These links deliberately expose only reviewed workflows that already exist.
 * A photo, voice note or provider history is not presented as importable until
 * there is extraction, consent and human review behind that promise.
 */
export default function OptionalSetupPaths({ agentId }: { agentId: string | null }) {
    const t = useTranslations("setupWizard.optionalPaths");
    const paths = PATHS.filter((path) => path.key !== "learning" || Boolean(agentId));

    return (
        <section className="mt-6" aria-labelledby="optional-setup-title">
            <h3 id="optional-setup-title" className="text-sm font-semibold text-foreground">{t("title")}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("subtitle")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {paths.map(({ key, icon: Icon, href }) => {
                    const destination = href(agentId || "");
                    const descriptionId = `optional-setup-${key}`;
                    return (
                        <Link
                            key={key}
                            href={destination}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-describedby={descriptionId}
                            className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10"
                        >
                            <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-foreground">
                                <span className="inline-flex items-center gap-2"><Icon size={15} aria-hidden="true" />{t(`${key}.title`)}</span>
                                <ArrowUpRight size={13} aria-hidden="true" />
                            </span>
                            <span id={descriptionId} className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground">
                                {t(`${key}.description`)}
                            </span>
                        </Link>
                    );
                })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{t("unsupported")}</p>
        </section>
    );
}
