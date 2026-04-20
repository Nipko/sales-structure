"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
    User,
    Shield,
    Bell,
    Palette,
    Building2,
    Globe,
    Clock,
    Database,
    Zap,
    MessageSquare,
    Mail,
    Image,
    Brain,
    SlidersHorizontal,
    Phone,
    Settings,
    ArrowRight,
    Info,
    Scale,
    type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

interface SettingsCard {
    label: string;
    description: string;
    href: string;
    icon: LucideIcon;
    iconColor: string;
    iconBg: string;
    superAdminOnly?: boolean;
}

interface SettingsSection {
    title: string;
    description: string;
    cards: SettingsCard[];
    adminOnly?: boolean;
    superAdminOnly?: boolean;
}

export default function SettingsHub() {
    const router = useRouter();
    const { user } = useAuth();
    const t = useTranslations("settings");
    const isAdmin = user?.role === "super_admin" || user?.role === "tenant_admin";
    const isSuperAdmin = user?.role === "super_admin";

    const sections: SettingsSection[] = [
        {
            title: t("account"), description: t("accountDesc"),
            cards: [
                { label: t("profile"), description: t("profileDesc"), href: "/admin/settings/profile", icon: User, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
                { label: t("security"), description: t("securityDesc"), href: "/admin/settings/security", icon: Shield, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
                { label: t("notifications"), description: t("notificationsDesc"), href: "/admin/settings/notifications", icon: Bell, iconColor: "text-rose-500", iconBg: "bg-rose-500/10" },
                { label: t("appearance"), description: t("appearanceDesc"), href: "/admin/settings/appearance", icon: Palette, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
            ],
        },
        {
            title: t("company"), description: t("companyDesc"), adminOnly: true,
            cards: [
                { label: t("general"), description: t("generalDesc"), href: "/admin/settings/company", icon: Building2, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
                { label: t("businessInfoCard"), description: t("businessInfoCardDesc"), href: "/admin/settings/business-info", icon: Info, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
                { label: t("policiesCard"), description: t("policiesCardDesc"), href: "/admin/settings/policies", icon: Scale, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
                { label: t("localization"), description: t("localizationDesc"), href: "/admin/settings/localization", icon: Globe, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
                { label: t("businessHours"), description: t("businessHoursDesc"), href: "/admin/settings/business-hours", icon: Clock, iconColor: "text-sky-500", iconBg: "bg-sky-500/10" },
            ],
        },
        {
            title: t("tools"), description: t("toolsDesc"), adminOnly: true,
            cards: [
                { label: t("customAttributes"), description: t("customAttributesDesc"), href: "/admin/settings/custom-attributes", icon: Database, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
                { label: t("macros"), description: t("macrosDesc"), href: "/admin/settings/macros", icon: Zap, iconColor: "text-orange-500", iconBg: "bg-orange-500/10" },
                { label: t("prechat"), description: t("prechatDesc"), href: "/admin/settings/prechat", icon: MessageSquare, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
                { label: t("emailTemplates"), description: t("emailTemplatesDesc"), href: "/admin/settings/email-templates", icon: Mail, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
                { label: t("mediaBank"), description: t("mediaBankDesc"), href: "/admin/settings/media", icon: Image, iconColor: "text-pink-500", iconBg: "bg-pink-500/10" },
            ],
        },
        {
            title: t("channelsSection"), description: t("channelsSectionDesc"), adminOnly: true, superAdminOnly: true,
            cards: [
                { label: t("channelConfig"), description: t("channelConfigDesc"), href: "/admin/settings/channels", icon: Phone, iconColor: "text-green-500", iconBg: "bg-green-500/10", superAdminOnly: true },
            ],
        },
        {
            title: t("aiModels"), description: t("aiModelsDesc"), adminOnly: true, superAdminOnly: true,
            cards: [
                { label: t("llmProviders"), description: t("llmProvidersDesc"), href: "/admin/settings/ai-providers", icon: Brain, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10", superAdminOnly: true },
                { label: t("aiConfig"), description: t("aiConfigDesc"), href: "/admin/settings/ai-config", icon: SlidersHorizontal, iconColor: "text-violet-500", iconBg: "bg-violet-500/10", superAdminOnly: true },
            ],
        },
        {
            title: t("monitoring"), description: t("monitoringDesc"), adminOnly: true,
            cards: [
                { label: t("alertsCard"), description: t("alertsCardDesc"), href: "/admin/settings/alerts", icon: Bell, iconColor: "text-rose-500", iconBg: "bg-rose-500/10" },
            ],
        },
        {
            title: t("platformSection"), description: t("platformSectionDesc"), adminOnly: true, superAdminOnly: true,
            cards: [
                { label: t("advanced"), description: t("advancedDesc"), href: "/admin/settings/platform", icon: Settings, iconColor: "text-neutral-500", iconBg: "bg-neutral-500/10", superAdminOnly: true },
            ],
        },
    ];

    return (
        <div className="space-y-8 max-w-5xl">
            <div>
                <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                    {t("title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {t("subtitle")}
                </p>
            </div>

            {/* Sections */}
            {sections.map((section) => {
                if (section.adminOnly && !isAdmin) return null;
                if (section.superAdminOnly && !isSuperAdmin) return null;
                const visibleCards = section.cards.filter(c => !(c.superAdminOnly && !isSuperAdmin));
                if (visibleCards.length === 0) return null;
                return (
                    <div key={section.title}>
                        <div className="mb-3">
                            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                                {section.title}
                            </h2>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                {section.description}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            {visibleCards.map((card) => {
                                const Icon = card.icon;
                                return (
                                    <button
                                        key={card.href}
                                        onClick={() => router.push(card.href)}
                                        className="group flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-white px-5 py-4 text-left hover-lift hover:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-500"
                                    >
                                        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", card.iconBg)}>
                                            <Icon size={20} className={card.iconColor} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                                {card.label}
                                            </div>
                                            <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">
                                                {card.description}
                                            </div>
                                        </div>
                                        <ArrowRight size={16} className="shrink-0 text-neutral-300 dark:text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
