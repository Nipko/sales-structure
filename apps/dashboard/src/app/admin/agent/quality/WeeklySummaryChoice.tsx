"use client";

import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

/** A voluntary delivery choice; opening this card never subscribes the owner. */
export function WeeklySummaryChoice() {
  const t = useTranslations("agentQuality.weeklySummary");
  return <aside className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-blue-950 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-100" aria-labelledby="weekly-summary-title">
    <div className="flex items-start gap-3">
      <span className="rounded-lg bg-white/70 p-2 text-blue-700 dark:bg-white/10 dark:text-blue-200"><Mail size={17} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <h2 id="weekly-summary-title" className="text-sm font-semibold">{t("title")}</h2>
        <p className="mt-1 text-xs leading-5 opacity-90">{t("description")}</p>
        <p className="mt-1 text-[11px] leading-5 opacity-75">{t("whatsappBoundary")}</p>
        <Link href="/admin/settings/alerts" className="mt-3 inline-flex min-h-8 items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {t("action")}<ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>
    </div>
  </aside>;
}
