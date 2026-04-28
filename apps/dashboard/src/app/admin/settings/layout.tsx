"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import {
    User, Shield, Bell, Palette, Building2, Globe, Clock,
    Database, Zap, MessageSquare, Mail, Image, Brain,
    SlidersHorizontal, Phone, Settings, CreditCard, type LucideIcon,
} from "lucide-react";

interface NavItem { i18nKey: string; href: string; icon: LucideIcon; }
interface NavSection { i18nKey: string; items: NavItem[]; adminOnly?: boolean; }

const NAV_SECTIONS: NavSection[] = [
    {
        i18nKey: "account",
        items: [
            { i18nKey: "profile", href: "/admin/settings/profile", icon: User },
            { i18nKey: "securityPage.title", href: "/admin/settings/security", icon: Shield },
            { i18nKey: "notifications", href: "/admin/settings/notifications", icon: Bell },
            { i18nKey: "appearance", href: "/admin/settings/appearance", icon: Palette },
        ],
    },
    {
        i18nKey: "company", adminOnly: true,
        items: [
            { i18nKey: "general", href: "/admin/settings/company", icon: Building2 },
            { i18nKey: "localization", href: "/admin/settings/localization", icon: Globe },
            { i18nKey: "businessHours", href: "/admin/settings/business-hours", icon: Clock },
            { i18nKey: "billing", href: "/admin/settings/billing", icon: CreditCard },
        ],
    },
    {
        i18nKey: "navTools", adminOnly: true,
        items: [
            { i18nKey: "customAttributes", href: "/admin/settings/custom-attributes", icon: Database },
            { i18nKey: "macros", href: "/admin/settings/macros", icon: Zap },
            { i18nKey: "prechat", href: "/admin/settings/prechat", icon: MessageSquare },
            { i18nKey: "emailTemplates", href: "/admin/settings/email-templates", icon: Mail },
            { i18nKey: "mediaBank", href: "/admin/settings/media", icon: Image },
        ],
    },
    {
        i18nKey: "channelsSection", adminOnly: true,
        items: [
            { i18nKey: "channelConfig", href: "/admin/settings/channels", icon: Phone },
        ],
    },
    {
        i18nKey: "aiModels", adminOnly: true,
        items: [
            { i18nKey: "llmProviders", href: "/admin/settings/ai-providers", icon: Brain },
            { i18nKey: "aiConfig", href: "/admin/settings/ai-config", icon: SlidersHorizontal },
        ],
    },
    {
        i18nKey: "platformSection", adminOnly: true,
        items: [
            { i18nKey: "advanced", href: "/admin/settings/platform", icon: Settings },
        ],
    },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user } = useAuth();
    const t = useTranslations("settings");
    const isAdmin = user?.role === "super_admin" || user?.role === "tenant_admin";
    const isActive = (href: string) => pathname === href;

    // Hub page — render children directly without sidebar
    if (pathname === "/admin/settings") {
        return <>{children}</>;
    }

    return (
        <div className="flex gap-6 -m-6">
            <aside className="w-[240px] shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 h-[calc(100vh-3.5rem)] overflow-y-auto sticky top-0">
                <div className="p-4 pb-2">
                    <Link href="/admin/settings"
                        className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors">
                        &larr; {t("title")}
                    </Link>
                </div>

                <nav className="px-2 pb-6 space-y-5">
                    {NAV_SECTIONS.map((section) => {
                        if (section.adminOnly && !isAdmin) return null;
                        return (
                            <div key={section.i18nKey}>
                                <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                    {t(section.i18nKey)}
                                </p>
                                <ul className="space-y-0.5">
                                    {section.items.map((item) => {
                                        const active = isActive(item.href);
                                        const Icon = item.icon;
                                        return (
                                            <li key={item.href}>
                                                <Link href={item.href}
                                                    className={cn(
                                                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                                                        active
                                                            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                                                            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                                                    )}>
                                                    <Icon size={16} className="shrink-0" />
                                                    <span>{t(item.i18nKey)}</span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </nav>
            </aside>

            <div className="flex-1 min-w-0 py-6 pr-6">
                {children}
            </div>
        </div>
    );
}
