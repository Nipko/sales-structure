"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Server, Database, HardDrive, CheckCircle, XCircle } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { PlatformHealth } from "./types";

interface Props {
  health: PlatformHealth | null;
}

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "#25d366",
  instagram: "#e4405f",
  messenger: "#0084ff",
  telegram: "#0088cc",
  sms: "#6b7280",
};

export default function PlatformTab({ health }: Props) {
  const t = useTranslations("tenants");

  const svcData = health?.services ?? (health as any);
  const services = [
    { name: "API", status: svcData?.api ?? false, icon: Server },
    { name: "Redis", status: svcData?.redis ?? false, icon: HardDrive },
    { name: "PostgreSQL", status: svcData?.postgres ?? false, icon: Database },
  ];

  const queues = health?.queues ?? [];

  const channelData = (health?.channelDistribution ?? []).map((d) => ({
    name: d.type,
    value: d.count,
    fill: CHANNEL_COLORS[d.type] || "#6b7280",
  }));

  return (
    <div className="space-y-6">
      {/* Service Status Cards */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">{t("sections.serviceStatus")}</h3>
        <div className="grid grid-cols-3 gap-3">
          {services.map((svc) => {
            const Icon = svc.icon;
            return (
              <div
                key={svc.name}
                className={cn(
                  "p-4 rounded-xl border flex items-center gap-3",
                  svc.status
                    ? "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-500/5"
                    : "border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-500/5"
                )}
              >
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", svc.status ? "bg-emerald-500/10" : "bg-red-500/10")}>
                  <Icon size={20} className={svc.status ? "text-emerald-500" : "text-red-500"} />
                </div>
                <div>
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">{svc.name}</div>
                  <div className="flex items-center gap-1 text-xs">
                    {svc.status ? (
                      <>
                        <CheckCircle size={12} className="text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">{t("status.online")}</span>
                      </>
                    ) : (
                      <>
                        <XCircle size={12} className="text-red-500" />
                        <span className="text-red-600 dark:text-red-400">{t("status.offline")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Queue Status */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("sections.queueStatus")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.queueName")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.waiting")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("status.active")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.delayed")}</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.failed")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {queues.map((q) => (
                  <tr key={q.name}>
                    <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{q.name}</td>
                    <td className="px-4 py-2 tabular-nums">{q.waiting}</td>
                    <td className="px-4 py-2 tabular-nums">{q.active}</td>
                    <td className="px-4 py-2 tabular-nums text-amber-600 dark:text-amber-400">{q.delayed}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {q.failed > 0 ? (
                        <span className="text-red-600 dark:text-red-400 font-medium">{q.failed}</span>
                      ) : (
                        <span className="text-neutral-400">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {queues.length === 0 && (
              <div className="py-8 text-center text-neutral-500 text-sm">--</div>
            )}
          </div>
        </div>

        {/* Channel Distribution Pie */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("sections.channelDistribution")}</h3>
          {channelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={channelData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name} (${value})`}
                >
                  {channelData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-neutral-500 text-sm">--</div>
          )}
        </div>
      </div>
    </div>
  );
}
