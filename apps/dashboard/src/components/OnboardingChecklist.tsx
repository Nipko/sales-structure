"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import { api } from "@/lib/api";
import { Check, ChevronDown, ChevronUp, X, ListChecks } from "lucide-react";

interface ChecklistItem {
    key: string;
    essential: boolean;
    href: string;
    actionKey: string;
    timeMin: number;
    check: (data: any) => boolean;
}

const ITEMS: ChecklistItem[] = [
    { key: "createAccount", essential: true, href: "", actionKey: "", timeMin: 0, check: () => true },
    { key: "configureAgent", essential: true, href: "/admin/agent", actionKey: "configure", timeMin: 3, check: (d) => d.hasPersona },
    { key: "connectChannel", essential: true, href: "/admin/channels", actionKey: "connect", timeMin: 3, check: (d) => d.hasAnyChannel },
    { key: "sendTestMessage", essential: true, href: "/admin/inbox", actionKey: "try", timeMin: 1, check: (d) => d.hasConversations },
    { key: "addKnowledgeBase", essential: false, href: "/admin/knowledge", actionKey: "configure", timeMin: 5, check: (d) => d.hasKnowledge },
    { key: "inviteTeam", essential: false, href: "/admin/users", actionKey: "invite", timeMin: 2, check: (d) => d.hasTeam },
    { key: "connectInstagram", essential: false, href: "/admin/channels/instagram", actionKey: "connect", timeMin: 3, check: (d) => d.hasInstagram },
    { key: "createAutomation", essential: false, href: "/admin/automation", actionKey: "create", timeMin: 5, check: (d) => d.hasAutomation },
    { key: "customizeTemplates", essential: false, href: "/admin/settings/email-templates", actionKey: "edit", timeMin: 3, check: (d) => d.hasTemplates },
];

export default function OnboardingChecklist() {
    const t = useTranslations("checklist");
    const tChecklist = useTranslations("verticalChecklist");
    const vt = useVerticalTerms();
    const { user } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const [checkData, setCheckData] = useState<any>({});
    const [loaded, setLoaded] = useState(false);

    const fetchStatus = useCallback(async () => {
        if (!user?.tenantId) return;
        try {
            const [setupRes, channelsRes] = await Promise.all([
                api.getSetupStatus(user.tenantId!),
                api.fetch(`/channels/overview?tenantId=${user.tenantId}`).catch(() => ({ channels: [] })),
            ]);

            const channels = channelsRes?.channels || channelsRes?.data?.channels || [];
            const hasAnyChannel = channels.some((c: any) => c.is_active);
            const hasInstagram = channels.some((c: any) => c.channel_type === "instagram" && c.is_active);
            const data = setupRes?.data || {};

            setCheckData({
                setupCompleted: data.setupWizardCompleted || false,
                hasPersona: data.hasPersona || data.setupWizardCompleted || false,
                hasAnyChannel,
                hasInstagram,
                hasConversations: data.hasConversations || false,
                hasKnowledge: data.hasKnowledge || false,
                hasTeam: data.hasTeam || false,
                hasAutomation: data.hasAutomation || false,
                hasTemplates: data.hasTemplates || false,
            });
        } catch {
            // Silently fail
        }
        setLoaded(true);
    }, [user?.tenantId]);

    useEffect(() => {
        if (!user?.tenantId) return;

        const key = `checklist_dismissed_${user.tenantId}`;
        if (localStorage.getItem(key) === "true") {
            setDismissed(true);
            setMinimized(true);
        }

        fetchStatus();
    }, [user?.tenantId, fetchStatus]);

    // Re-fetch on route change
    useEffect(() => {
        if (loaded && user?.tenantId) fetchStatus();
    }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch on window focus
    useEffect(() => {
        const onFocus = () => { if (user?.tenantId) fetchStatus(); };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") onFocus();
        });
        return () => {
            window.removeEventListener("focus", onFocus);
        };
    }, [user?.tenantId, fetchStatus]);

    if (!loaded || !user?.tenantId) return null;

    const completedCount = ITEMS.filter(item => item.check(checkData)).length;
    const totalCount = ITEMS.length;
    const percentage = Math.round((completedCount / totalCount) * 100);
    const allDone = completedCount === totalCount;

    // Minimized pill — shown when dismissed but not 100% complete
    if (minimized && dismissed && !allDone) {
        return (
            <button
                onClick={() => { setDismissed(false); setMinimized(false); }}
                className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-all hover:scale-105 cursor-pointer"
                title={t("reopenChecklist")}
            >
                <ListChecks size={16} />
                <span className="text-xs font-semibold">{completedCount}/{totalCount}</span>
                <div className="w-10 h-1.5 rounded-full bg-white/30 overflow-hidden">
                    <div className="h-full rounded-full bg-white transition-all" style={{ width: `${percentage}%` }} />
                </div>
            </button>
        );
    }

    if (dismissed || allDone) return null;

    const handleDismiss = () => {
        localStorage.setItem(`checklist_dismissed_${user.tenantId}`, "true");
        setDismissed(true);
        setMinimized(true);
    };

    const essentialItems = ITEMS.filter(i => i.essential);
    const recommendedItems = ITEMS.filter(i => !i.essential);

    return (
        <div className="border-l border-neutral-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.02] w-72 shrink-0 hidden xl:block overflow-y-auto">
            <div className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setCollapsed(!collapsed)} className="p-1 text-muted-foreground hover:text-foreground cursor-pointer">
                            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                        <button onClick={handleDismiss} className="p-1 text-muted-foreground hover:text-foreground cursor-pointer">
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-muted-foreground">{completedCount}/{totalCount} — {percentage}% {t("complete")}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${percentage}%` }} />
                    </div>
                </div>

                {!collapsed && (
                    <>
                        {/* Essentials */}
                        <div className="mb-4">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("essentials")}</p>
                            <div className="space-y-1.5">
                                {essentialItems.map(item => {
                                    const done = item.check(checkData);
                                    return (
                                        <div key={item.key} className="flex items-center gap-2.5">
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                                done ? "bg-emerald-500 text-white" : "border-2 border-neutral-300 dark:border-white/20"
                                            }`}>
                                                {done && <Check size={12} />}
                                            </div>
                                            <span className={`text-[12px] flex-1 ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                                {vt.industry !== 'otro' && tChecklist.has(`${vt.industry}.${item.key}`)
                                                    ? tChecklist(`${vt.industry}.${item.key}`)
                                                    : t(`items.${item.key}`)}
                                            </span>
                                            {!done && item.href && (
                                                <button
                                                    onClick={() => router.push(item.href)}
                                                    className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-medium hover:bg-indigo-500/20 transition-colors cursor-pointer"
                                                >
                                                    {t(`actions.${item.actionKey}`)}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Recommended */}
                        <div>
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("recommended")}</p>
                            <div className="space-y-1.5">
                                {recommendedItems.map(item => {
                                    const done = item.check(checkData);
                                    return (
                                        <div key={item.key} className="flex items-center gap-2.5">
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                                done ? "bg-emerald-500 text-white" : "border-2 border-neutral-300 dark:border-white/20"
                                            }`}>
                                                {done && <Check size={12} />}
                                            </div>
                                            <span className={`text-[12px] flex-1 ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                                {vt.industry !== 'otro' && tChecklist.has(`${vt.industry}.${item.key}`)
                                                    ? tChecklist(`${vt.industry}.${item.key}`)
                                                    : t(`items.${item.key}`)}
                                            </span>
                                            {!done && item.href && (
                                                <button
                                                    onClick={() => router.push(item.href)}
                                                    className="text-[10px] px-2 py-0.5 rounded bg-neutral-100 dark:bg-white/10 text-muted-foreground font-medium hover:text-foreground transition-colors cursor-pointer"
                                                >
                                                    {t(`actions.${item.actionKey}`)}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Dismiss */}
                        <button onClick={handleDismiss} className="mt-4 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                            {t("dismiss")}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
