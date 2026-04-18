"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Shared breadcrumbs — for detail pages (3+ depth levels).
 *
 * Rules (ui-ux-pro-max skill):
 * - breadcrumb-web: use for 3+ level deep hierarchies
 * - Always show current page as last (non-linked) item
 * - back-behavior: predictable back navigation
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1 text-sm", className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-neutral-400 dark:text-neutral-500" />}
            {isLast || !item.href ? (
              <span className={cn(
                "font-medium",
                isLast
                  ? "text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400"
              )}>
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors duration-150"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
