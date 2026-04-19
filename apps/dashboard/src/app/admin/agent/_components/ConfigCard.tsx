"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface ConfigCardProps {
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: ReactNode;
}

export function ConfigCard({
  icon: Icon,
  iconColor = "text-indigo-500 bg-indigo-500/10",
  title,
  summary,
  expanded,
  onToggle,
  children,
  badge,
}: ConfigCardProps) {
  const [iconText, iconBg] = iconColor.split(" ");

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      {/* Header — clickable */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left bg-transparent border-none cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors"
      >
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
          <Icon size={18} className={iconText} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {title}
            </span>
            {badge}
          </div>
          {!expanded && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
              {summary}
            </p>
          )}
        </div>
        <ChevronDown
          size={18}
          className={cn(
            "text-neutral-400 shrink-0 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Content — expandable */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-in-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5 pt-1 border-t border-neutral-100 dark:border-neutral-800">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
