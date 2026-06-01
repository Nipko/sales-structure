"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import {
    BookOpen, HelpCircle, Building2, Clock, Bot, ListChecks,
    Calendar, ShoppingCart, UtensilsCrossed, Home, Car,
    Users, BarChart3, Megaphone, Workflow, Inbox, UserPlus,
    Sparkles, ArrowRight, MessageCircle,
} from "lucide-react";

type Tool = { key: string; icon: typeof BookOpen; href: string };

const A_TRANSVERSAL: Tool[] = [
    { key: "knowledge", icon: BookOpen, href: "/admin/knowledge" },
    { key: "faqs", icon: HelpCircle, href: "/admin/knowledge/faqs" },
    { key: "businessInfo", icon: Building2, href: "/admin/settings/business-info" },
    { key: "hours", icon: Clock, href: "/admin/settings/business-hours" },
    { key: "persona", icon: Bot, href: "/admin/agent" },
    { key: "procedures", icon: ListChecks, href: "/admin/procedures" },
];

const A_BY_VERTICAL: Record<string, Tool[]> = {
    salud: [{ key: "appointments", icon: Calendar, href: "/admin/appointments" }],
    moda_belleza: [{ key: "appointments", icon: Calendar, href: "/admin/appointments" }],
    gimnasios: [{ key: "appointments", icon: Calendar, href: "/admin/appointments" }],
    veterinaria: [{ key: "appointments", icon: Calendar, href: "/admin/appointments" }],
    turismo: [{ key: "appointments", icon: Calendar, href: "/admin/appointments" }],
    retail: [{ key: "catalog", icon: ShoppingCart, href: "/admin/catalog" }],
    restaurantes: [{ key: "menu", icon: UtensilsCrossed, href: "/admin/menu" }],
    inmobiliaria: [{ key: "listings", icon: Home, href: "/admin/listings" }],
    automotriz: [{ key: "inventory", icon: Car, href: "/admin/inventory" }],
};

const B_TRANSVERSAL: Tool[] = [
    { key: "crm", icon: Users, href: "/admin/contacts" },
    { key: "analytics", icon: BarChart3, href: "/admin/analytics" },
    { key: "broadcast", icon: Megaphone, href: "/admin/broadcast" },
    { key: "automation", icon: Workflow, href: "/admin/automation" },
    { key: "inbox", icon: Inbox, href: "/admin/inbox" },
    { key: "team", icon: UserPlus, href: "/admin/users" },
];

export default function ToolsTour() {
    const t = useTranslations("setupWizard.discover");
    const router = useRouter();
    const { verticalConfig } = useAuth();
    const industry = ((verticalConfig as any)?.industry as string) || "otro";
    const blockA = [...A_TRANSVERSAL, ...(A_BY_VERTICAL[industry] || [])];

    const renderTool = (tool: Tool, primary: boolean) => {
        const Icon = tool.icon;
        return (
            <button
                key={tool.key}
                onClick={() => router.push(tool.href)}
                className={`flex items-start gap-3 ${primary ? "p-3.5" : "p-3"} rounded-xl border text-left transition-all cursor-pointer ${
                    primary
                        ? "border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/40"
                        : "border-neutral-200/70 dark:border-white/[0.06] bg-transparent hover:bg-neutral-50 dark:hover:bg-white/[0.03]"
                }`}
            >
                <div className={`rounded-lg flex items-center justify-center shrink-0 ${primary ? "w-9 h-9 bg-indigo-500/10 text-indigo-500" : "w-8 h-8 bg-neutral-100 dark:bg-white/10 text-muted-foreground"}`}>
                    <Icon size={primary ? 18 : 15} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className={`font-medium text-foreground ${primary ? "text-sm" : "text-[13px]"}`}>{t(`tools.${tool.key}.name`)}</p>
                    {primary && <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t(`tools.${tool.key}.desc`)}</p>}
                </div>
                <ArrowRight size={14} className="text-muted-foreground shrink-0 mt-1" />
            </button>
        );
    };

    return (
        <div className="space-y-6">
            {/* Block A — agent-empowering (primary emphasis) */}
            <div>
                <div className="flex items-center gap-2 mb-1">
                    <Sparkles size={15} className="text-indigo-500" />
                    <h3 className="text-sm font-semibold text-foreground">{t("blockATitle")}</h3>
                </div>
                <p className="text-[12px] text-muted-foreground mb-3">{t("blockASubtitle")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {blockA.map((tool) => renderTool(tool, true))}
                </div>
            </div>

            {/* Block B — management (light pass) */}
            <div>
                <h3 className="text-[13px] font-semibold text-muted-foreground mb-2">{t("blockBTitle")}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {B_TRANSVERSAL.map((tool) => renderTool(tool, false))}
                </div>
            </div>

            {/* Copilot card */}
            <div className="rounded-xl border border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
                    <MessageCircle size={20} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{t("copilotCardTitle")}</p>
                    <p className="text-[12px] text-muted-foreground leading-snug">{t("copilotCardDesc")}</p>
                </div>
                <button
                    onClick={() => {
                        try { localStorage.setItem("parallly:openCopilot", "1"); } catch { /* ignore */ }
                        window.dispatchEvent(new Event("parallly:open-copilot"));
                    }}
                    className="shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
                >
                    {t("openCopilot")}
                </button>
            </div>
        </div>
    );
}
