"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { SETUP_COPILOT_PENDING_KEY } from "@/lib/product-tour-contract";
import {
    resolveVerticalDashboard,
    type VerticalDashboardItem,
} from "@/lib/vertical-dashboard-resolver";
import {
    BookOpen, HelpCircle, Building2, Clock, Bot, ListChecks,
    Calendar, UtensilsCrossed, Home, Car, KeyRound,
    Users, BarChart3, Megaphone, Workflow, Inbox, UserPlus,
    Sparkles, ExternalLink, MessageCircle, Check,
    Stethoscope, Dumbbell, CreditCard, PawPrint, Plane,
    ShoppingBag, GraduationCap, Shield, Wrench, Camera, Package,
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

const A_BY_ITEM: Readonly<Partial<Record<VerticalDashboardItem, Tool>>> = {
    appointments: { key: "appointments", icon: Calendar, href: "/admin/appointments" },
    properties: { key: "properties", icon: Home, href: "/admin/properties" },
    tours: { key: "tours", icon: Plane, href: "/admin/tours" },
    listings: { key: "listings", icon: Home, href: "/admin/listings" },
    vehicles: { key: "vehicles", icon: Car, href: "/admin/vehicles" },
    resourceRentals: { key: "resourceRentals", icon: KeyRound, href: "/admin/resource-rentals" },
    menu: { key: "menu", icon: UtensilsCrossed, href: "/admin/menu" },
    foodOrders: { key: "orders", icon: ShoppingBag, href: "/admin/food-orders" },
    memberships: { key: "memberships", icon: CreditCard, href: "/admin/memberships" },
    classes: { key: "classes", icon: Dumbbell, href: "/admin/classes" },
    courses: { key: "courses", icon: GraduationCap, href: "/admin/courses" },
    insurance: { key: "insurance", icon: Shield, href: "/admin/insurance" },
    serviceRequests: { key: "serviceRequests", icon: Wrench, href: "/admin/service-requests" },
    treatmentPlans: { key: "treatments", icon: Stethoscope, href: "/admin/treatment-plans" },
    pets: { key: "pets", icon: PawPrint, href: "/admin/pets" },
    photoSessions: { key: "photoSessions", icon: Camera, href: "/admin/photo-sessions" },
    inventory: { key: "inventory", icon: Package, href: "/admin/inventory" },
    orders: { key: "orders", icon: ShoppingBag, href: "/admin/orders" },
};

const B_TRANSVERSAL: Tool[] = [
    { key: "crm", icon: Users, href: "/admin/contacts" },
    { key: "analytics", icon: BarChart3, href: "/admin/analytics-v2" },
    { key: "broadcast", icon: Megaphone, href: "/admin/broadcast" },
    { key: "automation", icon: Workflow, href: "/admin/automation" },
    { key: "inbox", icon: Inbox, href: "/admin/inbox" },
    { key: "team", icon: UserPlus, href: "/admin/users" },
];

export default function ToolsTour() {
    const t = useTranslations("setupWizard.discover");
    const { verticalConfig } = useAuth();
    const [copilotQueued, setCopilotQueued] = useState(false);
    const verticalDashboard = resolveVerticalDashboard(verticalConfig);
    const verticalTools = verticalDashboard.discoveryItems
        .map((item) => A_BY_ITEM[item])
        .filter((tool): tool is Tool => !!tool)
        .filter((tool, index, tools) => tools.findIndex((candidate) => candidate.key === tool.key) === index);
    const blockA = [...A_TRANSVERSAL, ...verticalTools];

    const renderTool = (tool: Tool, primary: boolean) => {
        const Icon = tool.icon;
        return (
            <a
                key={tool.key}
                href={tool.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t(`tools.${tool.key}.name`)} (${t("opensInNewTab")})`}
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
                <ExternalLink size={14} className="text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
            </a>
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
                        try { localStorage.setItem(SETUP_COPILOT_PENDING_KEY, "1"); } catch { /* optional */ }
                        setCopilotQueued(true);
                    }}
                    disabled={copilotQueued}
                    className="shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-emerald-600 text-white transition-colors cursor-pointer disabled:cursor-default inline-flex items-center gap-1.5"
                >
                    {copilotQueued && <Check size={14} aria-hidden="true" />}
                    {copilotQueued ? t("copilotQueued") : t("openCopilot")}
                </button>
            </div>
        </div>
    );
}
