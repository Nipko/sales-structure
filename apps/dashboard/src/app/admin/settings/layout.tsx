"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { getVisibleSections } from "./_settings-config";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const role = useRole();
    const t = useTranslations("settings");

    // Hub page — render children directly without secondary sidebar
    if (pathname === "/admin/settings") {
        return <>{children}</>;
    }

    const sections = getVisibleSections({
        canManageBilling: role.canManageBilling,
        isSupervisor: role.isSupervisor,
        canManagePlatform: role.canManagePlatform,
    });

    const isActive = (href: string) =>
        pathname === href || pathname.startsWith(href + "/");

    return (
        <div className="flex gap-6 -m-6">
            <aside className="w-[240px] shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 h-[calc(100vh-3.5rem)] overflow-y-auto sticky top-0">
                <div className="p-4 pb-2">
                    <Link
                        href="/admin/settings"
                        className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                    >
                        ← {t("title")}
                    </Link>
                </div>

                <nav className="px-2 pb-6 space-y-5">
                    {sections.map((section) => (
                        <div key={section.key}>
                            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
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
                                                <Icon size={16} className="shrink-0" />
                                                <span>{t(`items.${item.key}.label`)}</span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </nav>
            </aside>

            <div className="flex-1 min-w-0 py-6 pr-6">{children}</div>
        </div>
    );
}
