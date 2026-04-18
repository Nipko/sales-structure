"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  action?: ReactNode;
  badge?: ReactNode;
  breadcrumbs?: ReactNode;
  className?: string;
}

/**
 * Shared page header — consistent across all admin pages.
 *
 * Rules (ui-ux-pro-max skill):
 * - h1: text-xl font-semibold (never bold/extrabold)
 * - subtitle: text-sm neutral-500
 * - Optional icon with colored background
 * - Single primary CTA on right (if any)
 * - Optional breadcrumbs above title
 * - Optional badge (DataSourceBadge, status, etc.)
 */
export function PageHeader({ title, subtitle, icon: Icon, iconColor, action, badge, breadcrumbs, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", iconColor || "bg-indigo-500/10")}>
              <Icon size={20} className={iconColor?.includes("bg-") ? "text-white" : "text-indigo-500"} />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                {title}
              </h1>
              {badge}
            </div>
            {subtitle && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
