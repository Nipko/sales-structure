"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  breadcrumbs?: ReactNode;
  className?: string;
}

/**
 * Shared page header — consistent across all admin pages.
 *
 * Rules (ui-ux-pro-max skill):
 * - h1: text-xl font-semibold (never bold/extrabold)
 * - subtitle: text-sm neutral-500
 * - Single primary CTA on right (if any)
 * - Optional breadcrumbs above title
 */
export function PageHeader({ title, subtitle, action, breadcrumbs, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
