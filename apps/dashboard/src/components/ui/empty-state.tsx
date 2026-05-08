"use client";

import { motion } from "motion/react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface EmptyStateProps {
    icon?: LucideIcon;
    iconColor?: string;
    title: string;
    description?: string;
    action?: ReactNode;
    className?: string;
}

/**
 * Premium empty state — animated icon, title, optional description and action.
 * Replaces the bare "No hay X" text + icon combos scattered across pages.
 */
export function EmptyState({
    icon: Icon,
    iconColor = "text-neutral-400",
    title,
    description,
    action,
    className,
}: EmptyStateProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={cn(
                "flex flex-col items-center justify-center py-16 px-6 text-center",
                "bg-white dark:bg-neutral-900 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl",
                className,
            )}
        >
            {Icon && (
                <motion.div
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1, type: "spring", stiffness: 300, damping: 25 }}
                    className="mb-4 w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center ring-1 ring-inset ring-neutral-200 dark:ring-neutral-700"
                >
                    <Icon className={cn("w-7 h-7", iconColor)} />
                </motion.div>
            )}
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                {title}
            </h3>
            {description && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm leading-relaxed">
                    {description}
                </p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </motion.div>
    );
}
