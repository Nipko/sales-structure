"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useNavigationPageTitle } from "@/contexts/NavigationPageContext";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  action?: ReactNode;
  badge?: ReactNode;
  breadcrumbs?: ReactNode;
  /** Optional entity label used by the global breadcrumb instead of the H1. */
  navigationTitle?: string;
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
export function PageHeader({ title, subtitle, icon: Icon, iconColor, action, badge, navigationTitle, className }: PageHeaderProps) {
  useNavigationPageTitle(navigationTitle || title);

  return (
    <div className={cn("mb-6 min-w-0 max-w-full", className)}>
      {/* Breadcrumbs live in TopBar. The legacy prop remains accepted while
          callers migrate, but it is intentionally not rendered twice. */}
      <div className="flex min-w-0 max-w-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 max-w-full items-center gap-3">
          {Icon && (
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", iconColor || "bg-indigo-500/10")}>
              <Icon size={20} className={iconColor?.includes("bg-") ? "text-white" : "text-indigo-500"} />
            </div>
          )}
          <div className="min-w-0 max-w-full">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-xl font-semibold [overflow-wrap:anywhere] text-neutral-900 dark:text-neutral-100">
                {title}
              </h1>
              {badge}
            </div>
            {subtitle && (
              <p className="mt-0.5 min-w-0 break-words text-sm [overflow-wrap:anywhere] text-neutral-500 dark:text-neutral-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {action && (
          <div className="flex max-w-full flex-wrap items-center gap-2 sm:shrink-0 [&>*]:min-w-0 [&>*]:max-w-full [&>*]:flex-wrap">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
