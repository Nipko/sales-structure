"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRole } from "@/hooks/useRole";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronDown, Building2, Clock, Users, Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { HelpPanel } from "@/components/ui/help-panel";
import {
    getVisibleSections,
    resolveSettingsReturnTo,
    withSettingsReturnTo,
} from "./_settings-config";

/**
 * The four screens an agent cannot work without, pulled to the top of a hub of
 * ~30 cards. Everything here also lives in its own group below; this strip only
 * changes the ORDER in which a first-time owner meets them.
 */
const ESSENTIALS = [
    { key: "businessInfo", href: "/admin/settings/business-info", icon: Building2, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
    { key: "businessHours", href: "/admin/settings/business-hours", icon: Clock, iconColor: "text-sky-500", iconBg: "bg-sky-500/10" },
    { key: "team", href: "/admin/users", icon: Users, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
    { key: "setupWizard", href: "/admin/setup-wizard", icon: Compass, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
] as const;

/** Groups that stay folded: nothing here is part of getting the agent working. */
const COLLAPSED_SECTIONS = new Set(["developer"]);

export default function SettingsHub() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const role = useRole();
    const t = useTranslations("settings");
    const tHelp = useTranslations("help");

    const sections = getVisibleSections({
        canManageBilling: role.canManageBilling,
        isSupervisor: role.isSupervisor,
        canManagePlatform: role.canManagePlatform,
        isSuperAdminPlatformMode: role.isSuperAdmin && !role.impersonating,
    });
    const returnTo = resolveSettingsReturnTo(
        searchParams.get("returnTo"),
        role.canAccess,
        "/admin/settings",
    );

    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const isOpen = (key: string) => openGroups[key] ?? !COLLAPSED_SECTIONS.has(key);

    // A platform-mode super_admin has no tenant to configure; the strip would
    // point at screens that need one.
    const showEssentials = !(role.isSuperAdmin && !role.impersonating);
    const essentials = ESSENTIALS.filter((item) => role.canAccess(item.href));

    return (
        <div className="space-y-8 max-w-4xl">
            <HelpPanel
                title={tHelp("settings.title")}
                description={tHelp("settings.description")}
                tips={tHelp.raw("settings.tips") as string[]}
                mediaKey="settings"
                tourId="help_system"
            />

            {showEssentials && essentials.length > 0 && (
                <section className="space-y-3">
                    <div>
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                            {t("essentials.title")}
                        </h2>
                        <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-0.5">
                            {t("essentials.description")}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {essentials.map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.key}
                                    onClick={() => router.push(withSettingsReturnTo(item.href, returnTo))}
                                    className="group relative bg-card border border-indigo-200 dark:border-indigo-500/25 rounded-xl p-4 text-left hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-200 flex items-start gap-3 cursor-pointer overflow-hidden"
                                >
                                    <div className={cn(
                                        "relative w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-current/10",
                                        item.iconBg,
                                    )}>
                                        <Icon className={cn("h-5 w-5", item.iconColor)} />
                                    </div>
                                    <div className="relative flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                                                {t(`essentials.items.${item.key}.label`)}
                                            </span>
                                            <ArrowRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                                        </div>
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
                                            {t(`essentials.items.${item.key}.description`)}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            {sections.map((section, sIdx) => (
                <motion.div
                    key={section.key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: sIdx * 0.04 }}
                    className="space-y-3"
                >
                    <button
                        type="button"
                        onClick={() => setOpenGroups((prev) => ({ ...prev, [section.key]: !isOpen(section.key) }))}
                        aria-expanded={isOpen(section.key)}
                        className="w-full flex items-start gap-2 text-left bg-transparent border-none p-0 cursor-pointer"
                    >
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 mt-0.5 flex-shrink-0 text-neutral-400 transition-transform",
                                !isOpen(section.key) && "-rotate-90",
                            )}
                        />
                        <div>
                            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                                {t(`sections.${section.key}.title`, { defaultValue: section.key.charAt(0).toUpperCase() + section.key.slice(1) })}
                            </h2>
                            <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-0.5">
                                {t(`sections.${section.key}.description`, { defaultValue: "" })}
                            </p>
                        </div>
                    </button>

                    <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3", !isOpen(section.key) && "hidden")}>
                        {section.items.map((card, i) => {
                            const Icon = card.icon;
                            return (
                                <motion.button
                                    key={card.key}
                                    onClick={() => router.push(withSettingsReturnTo(card.href, returnTo))}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: 0.04 * i }}
                                    whileHover={{ y: -2 }}
                                    className={cn(
                                        "group relative bg-card border border-border rounded-xl p-4 text-left",
                                        "hover:border-indigo-300 dark:hover:border-indigo-700",
                                        "hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-200",
                                        "flex items-start gap-3 cursor-pointer overflow-hidden",
                                    )}
                                >
                                    {/* Subtle gradient wash on hover */}
                                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-transparent to-indigo-500/0 group-hover:from-indigo-500/[0.03] group-hover:to-indigo-500/[0.06] transition-colors pointer-events-none" />

                                    <div className={cn(
                                        "relative w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                                        "ring-1 ring-inset ring-current/10 transition-transform group-hover:scale-105",
                                        card.iconBg,
                                    )}>
                                        <Icon className={cn("h-5 w-5", card.iconColor)} />
                                    </div>
                                    <div className="relative flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                                                {t(`items.${card.key}.label`, { defaultValue: card.key.charAt(0).toUpperCase() + card.key.slice(1).replace(/_/g, " ") })}
                                            </span>
                                            <ArrowRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                                        </div>
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
                                            {t(`items.${card.key}.description`, { defaultValue: "" })}
                                        </p>
                                    </div>
                                </motion.button>
                            );
                        })}
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
