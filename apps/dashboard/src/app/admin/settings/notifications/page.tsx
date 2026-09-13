"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { PushNotificationToggle } from "@/components/pwa/PushNotificationToggle";
import {
    Bell,
    MessageSquare,
    UserCheck,
    Shield,
    CalendarDays,
    Workflow,
    ShoppingCart,
    Settings,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import type { NotificationCategoryKey } from "@/lib/notification-preferences";

interface NotificationCategory {
    id: NotificationCategoryKey;
    labelKey: string;
    descriptionKey: string;
    icon: any;
    iconColor: string;
    enabled: boolean;
}

const categories: Omit<NotificationCategory, "enabled">[] = [
    { id: "chat", labelKey: "catChat", descriptionKey: "catChatDesc", icon: MessageSquare, iconColor: "text-green-500" },
    { id: "handoff", labelKey: "catHandoff", descriptionKey: "catHandoffDesc", icon: UserCheck, iconColor: "text-blue-500" },
    { id: "compliance", labelKey: "catCompliance", descriptionKey: "catComplianceDesc", icon: Shield, iconColor: "text-amber-500" },
    { id: "appointments", labelKey: "catAppointments", descriptionKey: "catAppointmentsDesc", icon: CalendarDays, iconColor: "text-purple-500" },
    { id: "automation", labelKey: "catAutomation", descriptionKey: "catAutomationDesc", icon: Workflow, iconColor: "text-indigo-500" },
    { id: "orders", labelKey: "catOrders", descriptionKey: "catOrdersDesc", icon: ShoppingCart, iconColor: "text-emerald-500" },
    { id: "system", labelKey: "catSystem", descriptionKey: "catSystemDesc", icon: Settings, iconColor: "text-neutral-500" },
];

export default function NotificationsPage() {
    const t = useTranslations("notifications");
    const tHelp = useTranslations("help");
    const { preferences, loading, saving, error, updatePreferences } = useNotificationPreferences();

    const toggleCategory = (id: NotificationCategoryKey) => {
        void updatePreferences({ ...preferences, categories: {
            ...preferences.categories, [id]: !preferences.categories[id],
        } });
    };

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {t("subtitle")}
                </p>
            </div>

            <HelpPanel
                title={tHelp("settingsNotifications.title")}
                description={tHelp("settingsNotifications.description")}
                tips={tHelp.raw("settingsNotifications.tips") as string[]}
                mediaKey="settingsNotifications"
            />

            {/* Push notifications */}
            <PushNotificationToggle />

            {/* General preferences */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900 space-y-5">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t("generalPrefs")}</h2>

                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t("sound")}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">{t("soundDesc")}</div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={preferences.soundEnabled}
                        aria-label={t("sound")}
                        onClick={() => void updatePreferences({ ...preferences, soundEnabled: !preferences.soundEnabled })}
                        disabled={loading || saving}
                        className={cn(
                            "relative h-6 w-12 shrink-0 cursor-pointer rounded-full border-none transition-colors",
                            preferences.soundEnabled ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                        )}
                    >
                        <div className={cn(
                            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200",
                            preferences.soundEnabled ? "left-[27px]" : "left-[3px]"
                        )} />
                    </button>
                </div>
            </div>

            {/* Categories */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                    {t("categories")}
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-5">
                    {t("categoriesDesc")}
                </p>

                <div className="space-y-3">
                    {categories.map((cat) => {
                        const Icon = cat.icon;
                        const enabled = preferences.categories[cat.id];
                        return (
                            <div
                                key={cat.id}
                                className="flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-800/50"
                            >
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-neutral-800">
                                    <Icon size={18} className={cat.iconColor} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{t(cat.labelKey)}</div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{t(cat.descriptionKey)}</div>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={enabled}
                                    aria-label={t(cat.labelKey)}
                                    onClick={() => toggleCategory(cat.id)}
                                    disabled={loading || saving}
                                    className={cn(
                                        "relative h-6 w-12 shrink-0 cursor-pointer rounded-full border-none transition-colors",
                                        enabled ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                                    )}
                                >
                                    <div className={cn(
                                        "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200",
                                        enabled ? "left-[27px]" : "left-[3px]"
                                    )} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div
                role={error ? "alert" : "status"}
                aria-live="polite"
                className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-neutral-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-neutral-400"
            >
                <Bell size={14} className="text-indigo-500 shrink-0" />
                {error ? t("saveError") : saving ? t("saving") : t("serverNote")}
            </div>
        </div>
    );
}
