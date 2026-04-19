"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Clock, ArrowRight, Info } from "lucide-react";
import { DAY_LABELS } from "../_types";
import type { PersonaConfig } from "../_types";

interface ScheduleCardProps {
  config: PersonaConfig;
}

export function ScheduleCard({ config }: ScheduleCardProps) {
  const schedule = config.hours.schedule;

  // Check if 24/7
  const is247 = Object.values(schedule).every(
    v => v !== null && (v as { start: string; end: string }).start === "00:00" && (v as { start: string; end: string }).end === "23:59"
  );

  // Build compact summary
  let summary: string;
  if (is247) {
    summary = "24/7 - Always available";
  } else {
    const activeDays = Object.entries(schedule)
      .filter(([, v]) => v !== null)
      .map(([key, v]) => {
        const day = DAY_LABELS[key]?.slice(0, 3) ?? key;
        const s = v as { start: string; end: string };
        return `${day} ${s.start}-${s.end}`;
      });
    summary = activeDays.length > 0 ? activeDays.join(", ") : "No schedule configured";
  }

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/10">
            <Clock size={18} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Schedule
            </span>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
              {summary}
            </p>
          </div>
        </div>

        {/* Info note */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 mb-3">
          <Info size={14} className="text-neutral-400 shrink-0 mt-0.5" />
          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
            Controls when your agent responds to messages. Manage your business hours in Settings.
          </p>
        </div>

        {/* Link to business hours */}
        <Link
          href="/admin/settings"
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-500 hover:text-indigo-600",
            "dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
          )}
        >
          Configure hours <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
