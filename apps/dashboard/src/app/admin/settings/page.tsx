"use client";

import { useRouter } from "next/navigation";
import { useRole } from "@/hooks/useRole";
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
    RotateCcw,
    type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { HelpPanel } from "@/components/ui/help-panel";

interface SettingsCard {
    label: string;
    description: string;
    href: string;
    icon: LucideIcon;
    iconColor: string;
    iconBg: string;
    /** Visibility predicate against useRole(). Returns true → card visible. */
    visible?: (r: ReturnType<typeof useRole>) => boolean;
}

interface SettingsSection {
    title: string;
    description: string;
    cards: SettingsCard[];
    /** If provided, hide section when predicate returns false */
    visible?: (r: ReturnType<typeof useRole>) => boolean;
}

export default function SettingsHub() {
    const router = useRouter();
    const role = useRole();
    const t = useTranslations("settings");
    const tHelp = useTranslations("help");

    const sections: SettingsSection[] = [
        // Account — visible to everyone (their own profile / security / etc.)
        {
            title: t("account"), description: t("accountDesc"),
            cards: [
                { label: t("profile"), description: t("profileDesc"), href: "/admin/settings/profile", icon: User, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
                { label: t("security"), description: t("securityDesc"), href: "/admin/settings/security", icon: Shield, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
                { label: t("notifications"), description: t("notificationsDesc"), href: "/admin/settings/notifications", icon: Bell, iconColor: "text-rose-500", iconBg: "bg-rose-500/10" },
                { label: t("appearance"), description: t("appearanceDesc"), href: "/admin/settings/appearance", icon: Palette, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
            ],
        },
        // Company — tenant_admin only (settings that affect the whole tenant)
        {
            title: t("company"), description: t("companyDesc"),
            visible: (r) => r.canManageBilling || r.isSupervisor,  // admin or super_admin impersonating
            cards: [
                { label: t("general"), description: t("generalDesc"), href: "/admin/settings/company", icon: Building2, iconColor: "text-blue-500", iconBg: "bg-blue-500/10", visible: (r) => r.canManageBilling },
                { label: t("businessInfoCard"), description: t("businessInfoCardDesc"), href: "/admin/settings/business-info", icon: Info, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10", visible: (r) => r.canManageBilling },
                { label: t("policiesCard"), description: t("policiesCardDesc"), href: "/admin/settings/policies", icon: Scale, iconColor: "text-amber-500", iconBg: "bg-amber-500/10", visible: (r) => r.canManageBilling },
                { label: t("localization"), description: t("localizationDesc"), href: "/admin/settings/localization", icon: Globe, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10", visible: (r) => r.isSupervisor },
                { label: t("businessHours"), description: t("businessHoursDesc"), href: "/admin/settings/business-hours", icon: Clock, iconColor: "text-sky-500", iconBg: "bg-sky-500/10", visible: (r) => r.isSupervisor },
            ],
        },
        // Tools — supervisor+ (most workflows like macros, templates, prechat)
        {
            title: t("tools"), description: t("toolsDesc"),
            visible: (r) => r.isSupervisor,
            cards: [
                { label: t("customAttributes"), description: t("customAttributesDesc"), href: "/admin/settings/custom-attributes", icon: Database, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
                { label: t("macros"), description: t("macrosDesc"), href: "/admin/settings/macros", icon: Zap, iconColor: "text-orange-500", iconBg: "bg-orange-500/10" },
                { label: t("prechat"), description: t("prechatDesc"), href: "/admin/settings/prechat", icon: MessageSquare, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
                { label: t("emailTemplates"), description: t("emailTemplatesDesc"), href: "/admin/settings/email-templates", icon: Mail, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
                { label: t("mediaBank"), description: t("mediaBankDesc"), href: "/admin/settings/media", icon: Image, iconColor: "text-pink-500", iconBg: "bg-pink-500/10" },
            ],
        },
        // Monitoring — admin and supervisor see alerts; recall is admin-only
        {
            title: t("monitoring"), description: t("monitoringDesc"),
            visible: (r) => r.isSupervisor,
            cards: [
                { label: t("alertsCard"), description: t("alertsCardDesc"), href: "/admin/settings/alerts", icon: Bell, iconColor: "text-rose-500", iconBg: "bg-rose-500/10" },
                { label: t("recallCard"), description: t("recallCardDesc"), href: "/admin/settings/recall", icon: RotateCcw, iconColor: "text-cyan-500", iconBg: "bg-cyan-500/10", visible: (r) => r.canManageBilling },
            ],
        },
        // Channels phone setup — super_admin only
        {
            title: t("channelsSection"), description: t("channelsSectionDesc"),
            visible: (r) => r.canManagePlatform,
            cards: [
                { label: t("channelConfig"), description: t("channelConfigDesc"), href: "/admin/settings/channels", icon: Phone, iconColor: "text-green-500", iconBg: "bg-green-500/10" },
            ],
        },
        // AI Models — super_admin only
        {
            title: t("aiModels"), description: t("aiModelsDesc"),
            visible: (r) => r.canManagePlatform,
            cards: [
                { label: t("llmProviders"), description: t("llmProvidersDesc"), href: "/admin/settings/ai-providers", icon: Brain, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
                { label: t("aiConfig"), description: t("aiConfigDesc"), href: "/admin/settings/ai-config", icon: SlidersHorizontal, iconColor: "text-violet-500", iconBg: "bg-violet-500/10" },
            ],
        },
        // Platform — super_admin only
        {
            title: t("platformSection"), description: t("platformSectionDesc"),
            visible: (r) => r.canManagePlatform,
            cards: [
                { label: t("advanced"), description: t("advancedDesc"), href: "/admin/settings/platform", icon: Settings, iconColor: "text-neutral-500", iconBg: "bg-neutral-500/10" },
            ],
        },
    ];

    // Apply visibility filters
    const visibleSections = sections
        .filter(s => !s.visible || s.visible(role))
        .map(s => ({
            ...s,
            cards: s.cards.filter(c => !c.visible || c.visible(role)),
        }))
        .filter(s => s.cards.length > 0);

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

            <HelpPanel
                title={tHelp("settings.title")}
                description={tHelp("settings.description")}
                videoUrl={tHelp("settings.videoUrl")}
            />

            {visibleSections.map((section, idx) => (
                <div key={idx} className="space-y-3">
                    <div>
                        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                            {section.title}
                        </h2>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {section.description}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {section.cards.map((card, i) => {
                            const Icon = card.icon;
                            return (
                                <button
                                    key={i}
                                    onClick={() => router.push(card.href)}
                                    className={cn(
                                        "group bg-card border border-border rounded-xl p-4 text-left",
                                        "hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all",
                                        "flex items-start gap-3",
                                    )}
                                >
                                    <div className={cn(
                                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                                        card.iconBg,
                                    )}>
                                        <Icon className={cn("h-5 w-5", card.iconColor)} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                                                {card.label}
                                            </span>
                                            <ArrowRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
                                        </div>
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                                            {card.description}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
