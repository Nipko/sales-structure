"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PremiumCardProps {
    href?: string;
    onClick?: () => void;
    icon?: LucideIcon;
    iconColor?: string;
    iconBg?: string;
    title?: string;
    subtitle?: string;
    description?: string;
    badge?: ReactNode;
    /** Custom right slot (replaces the arrow) */
    rightSlot?: ReactNode;
    /** Position in stagger entrance animation (0,1,2…) */
    index?: number;
    children?: ReactNode;
    className?: string;
    /** Disable hover lift (e.g. for read-only display cards) */
    static?: boolean;
}

/**
 * Reusable card with the premium polish pattern: subtle gradient hover wash,
 * lift on hover, icon container with ring, arrow translate microinteraction,
 * stagger entry animation per index.
 *
 * Either pass children for fully custom content, or pass icon+title+description
 * for the standard layout.
 */
export function PremiumCard({
    href,
    onClick,
    icon: Icon,
    iconColor = "text-indigo-500",
    iconBg = "bg-indigo-500/10",
    title,
    subtitle,
    description,
    badge,
    rightSlot,
    index = 0,
    children,
    className,
    static: isStatic = false,
}: PremiumCardProps) {
    const interactive = Boolean(href || onClick);

    const inner = (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.04 * Math.min(index, 8) }}
            whileHover={!isStatic && interactive ? { y: -2 } : undefined}
            className={cn(
                "group relative bg-card border border-border rounded-xl overflow-hidden",
                interactive && !isStatic && [
                    "hover:border-indigo-300 dark:hover:border-indigo-700",
                    "hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-200",
                    "cursor-pointer",
                ],
                children ? "p-0" : "p-4",
                className,
            )}
        >
            {/* Subtle gradient wash on hover */}
            {interactive && !isStatic && (
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-transparent to-indigo-500/0 group-hover:from-indigo-500/[0.03] group-hover:to-indigo-500/[0.06] transition-colors pointer-events-none" />
            )}

            {children ? (
                <div className="relative">{children}</div>
            ) : (
                <div className="relative flex items-start gap-3">
                    {Icon && (
                        <div
                            className={cn(
                                "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                                "ring-1 ring-inset ring-current/10 transition-transform",
                                interactive && !isStatic && "group-hover:scale-105",
                                iconBg,
                            )}
                        >
                            <Icon className={cn("h-5 w-5", iconColor)} />
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                                {title && (
                                    <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100 truncate">
                                        {title}
                                    </span>
                                )}
                                {badge}
                            </div>
                            {rightSlot || (interactive && !isStatic && (
                                <ArrowRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                            ))}
                        </div>
                        {subtitle && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 truncate">
                                {subtitle}
                            </p>
                        )}
                        {description && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                                {description}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </motion.div>
    );

    if (href) {
        return (
            <Link href={href} className="block no-underline">
                {inner}
            </Link>
        );
    }

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="w-full text-left bg-transparent border-0 p-0 cursor-pointer"
            >
                {inner}
            </button>
        );
    }

    return inner;
}

/**
 * Grid container with responsive columns + stagger entry. Wrap PremiumCards.
 */
export function PremiumGrid({
    children,
    cols = "1-2-3",
    className,
}: {
    children: ReactNode;
    /** "1-2-3" = 1 col mobile, 2 tablet, 3 desktop. "1-2-4" = up to 4. */
    cols?: "1-2-3" | "1-2-4" | "1-3";
    className?: string;
}) {
    const gridCols = {
        "1-2-3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        "1-2-4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        "1-3": "grid-cols-1 lg:grid-cols-3",
    }[cols];
    return <div className={cn("grid gap-3", gridCols, className)}>{children}</div>;
}
