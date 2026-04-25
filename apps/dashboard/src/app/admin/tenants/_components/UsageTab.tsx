"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PlatformUsage } from "./types";

interface Props {
  usage: PlatformUsage | null;
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const color =
    pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <div className="flex-1 h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs text-neutral-500 tabular-nums whitespace-nowrap">
        {used.toLocaleString()}/{limit.toLocaleString()}
      </span>
    </div>
  );
}

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trialing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  past_due: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cancelled: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
  suspended: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export default function UsageTab({ usage }: Props) {
  const t = useTranslations("tenants");

  const rows = usage?.tenants ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.tenant")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.planCol")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.automation")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.outbound")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.statusCol")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">{row.name}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{row.plan}</td>
                  <td className="px-4 py-3">
                    <UsageBar used={row.automationUsed} limit={row.automationLimit} />
                  </td>
                  <td className="px-4 py-3">
                    <UsageBar used={row.outboundUsed} limit={row.outboundLimit} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", statusColor[row.status] || statusColor.active)}>
                      {t(`status.${row.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>
    </div>
  );
}
