"use client";

import { useState, useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Settings, Search, ArrowLeft } from "lucide-react";
import { getVisibleSections } from "./_settings-config";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const role = useRole();
    const t = useTranslations("settings");
    const [search, setSearch] = useState("");

    const sections = getVisibleSections({
        canManageBilling: role.canManageBilling,
        isSupervisor: role.isSupervisor,
        canManagePlatform: role.canManagePlatform,
        isSuperAdminPlatformMode: role.isSuperAdmin && !role.impersonating,
    });

    const filteredSections = useMemo(() => {
        if (!search.trim()) return sections;
        const q = search.toLowerCase();
        return sections
            .map((s) => ({
                ...s,
                items: s.items.filter((item) =>
                    t(`items.${item.key}.label`).toLowerCase().includes(q) ||
                    t(`items.${item.key}.description`).toLowerCase().includes(q)
                ),
            }))
            .filter((s) => s.items.length > 0);
    }, [sections, search, t]);

    const isActive = (href: string) =>
        pathname === href || pathname.startsWith(href + "/");

    const isHub = pathname === "/admin/settings";

    return (
        <div className="flex -m-6">
            <aside className="w-[260px] shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 h-[calc(100vh-3.5rem)] overflow-y-auto sticky top-0 flex flex-col">
                {/* Header */}
                <div className="p-4 pb-3 border-b border-neutral-200/60 dark:border-neutral-800/60 shrink-0">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-indigo-500 transition-colors mb-3">
                        <ArrowLeft size={12} />
                        <span>{t("backToDashboard")}</span>
                    </Link>
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/15 flex items-center justify-center ring-1 ring-inset ring-indigo-200/60 dark:ring-indigo-800/40">
                            <Settings size={18} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-[15px] font-bold text-neutral-900 dark:text-neutral-100">{t("title")}</h2>
                            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{t("sidebarSubtitle")}</p>
                        </div>
                    </div>
                </div>

                {/* Search */}
                <div className="px-3 pt-3 pb-1 shrink-0">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t("searchSettings")}
                            className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg text-xs text-neutral-700 dark:text-neutral-300 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
                        />
                    </div>
                </div>

                {/* Nav items */}
                <nav className="flex-1 overflow-y-auto px-2 pb-6 pt-2 space-y-4 custom-scrollbar">
                    {filteredSections.length === 0 ? (
                        <p className="px-3 py-6 text-xs text-neutral-400 text-center">{t("noResults")}</p>
                    ) : (
                        filteredSections.map((section) => (
                            <div key={section.key}>
                                <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                    {t(`sections.${section.key}.title`)}
                                </p>
                                <ul className="space-y-0.5">
                                    {section.items.map((item) => {
                                        const active = isActive(item.href);
                                        const Icon = item.icon;
                                        return (
                                            <li key={item.key} className="relative">
                                                {active && (
                                                    <motion.div
                                                        layoutId="settings-nav-active"
                                                        className="absolute inset-0 bg-indigo-50 dark:bg-indigo-950/60 rounded-lg ring-1 ring-indigo-200/60 dark:ring-indigo-800/60"
                                                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                                                    />
                                                )}
                                                <Link
                                                    href={item.href}
                                                    className={cn(
                                                        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                                                        active
                                                            ? "text-indigo-700 dark:text-indigo-300"
                                                            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                                                    )}
                                                >
                                                    <Icon size={16} className={cn("shrink-0", active ? "text-indigo-500" : "")} />
                                                    <span className="truncate">{t(`items.${item.key}.label`)}</span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))
                    )}
                </nav>
            </aside>

            <div className={cn("flex-1 min-w-0 overflow-y-auto h-[calc(100vh-3.5rem)]", isHub ? "p-6" : "py-6 px-6")}>{children}</div>
        </div>
    );
}
