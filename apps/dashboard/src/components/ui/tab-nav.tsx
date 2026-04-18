"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: number;
}

interface TabNavProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

/**
 * Shared underline tab navigation — Stripe/Linear pattern.
 * Use for sub-navigation within sections (2-7 tabs).
 *
 * Features:
 * - Underline active indicator (not background)
 * - 150ms transition on hover/active
 * - Optional icon per tab
 * - Optional count badge
 * - Horizontal scroll on mobile
 * - Keyboard accessible
 */
export function TabNav({ tabs, activeTab, onTabChange, className }: TabNavProps) {
  return (
    <div className={cn("border-b border-neutral-200 dark:border-neutral-800", className)}>
      <nav className="flex gap-0 -mb-px overflow-x-auto" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap",
                "cursor-pointer bg-transparent transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100"
                  : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600"
              )}
            >
              {Icon && <Icon size={15} />}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300 tabular-nums">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
