"use client";

import { useId, useState } from "react";
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
    Briefcase, BedDouble, Compass, Tags,
} from "lucide-react";

type Tool = {
    key: string;
    icon: typeof BookOpen;
    href: string;
    /**
     * Whether the card carries the four-facet briefing below its description.
     *
     * A card with `brief` answers the questions somebody actually has before
     * opening a screen they have never seen: what it needs from them, what they
     * can verify once they are there, what having it working costs, and how to
     * try it. It is opt-in per card because the copy has to be true of that
     * screen — a generic briefing would be worse than none.
     */
    brief?: true;
};

/** Read in this order: it goes from "can I even" to "did it work". */
const BRIEF_FACETS = ["needs", "confirms", "cost", "test"] as const;

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
    repairOrders: { key: "repairOrders", icon: Wrench, href: "/admin/repair-orders" },
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
    // Los cuatro que el resolver sabía proyectar y el tour dejaba caer. Los
    // tres registros operativos ni siquiera llegaban a `DISCOVERY_ORDER`;
    // `serviceCatalog` sí llegaba, y el `.filter(Boolean)` de abajo lo borraba
    // en silencio — una guardería abría el tour y no veía la única pantalla
    // donde viven sus paquetes.
    stays: { key: "stays", icon: BedDouble, href: "/admin/stays", brief: true },
    tourBookings: { key: "tourBookings", icon: Compass, href: "/admin/tour-bookings", brief: true },
    cases: { key: "cases", icon: Briefcase, href: "/admin/cases", brief: true },
    serviceCatalog: { key: "serviceCatalog", icon: Tags, href: "/admin/service-catalog", brief: true },
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
    const briefId = useId();
    const [copilotQueued, setCopilotQueued] = useState(false);
    const verticalDashboard = resolveVerticalDashboard(verticalConfig);
    const verticalTools = verticalDashboard.discoveryItems
        .map((item) => A_BY_ITEM[item])
        // The filter stays because a tenant must never see a crash over a
        // missing card — but it is the reason a gap is invisible in production,
        // so `tools-tour-coverage.spec.ts` fails the build instead.
        .filter((tool): tool is Tool => !!tool)
        .filter((tool, index, tools) => tools.findIndex((candidate) => candidate.key === tool.key) === index);
    const blockA = [...A_TRANSVERSAL, ...verticalTools];

    const renderTool = (tool: Tool, primary: boolean) => {
        const Icon = tool.icon;
        // The briefing is the link's description rather than part of its name:
        // a screen reader announces "Casos, abre en una pestaña nueva" and then
        // the four facets, instead of one forty-word name.
        const briefed = primary && tool.brief;
        const describedBy = briefed ? `${briefId}-${tool.key}` : undefined;
        return (
            <a
                key={tool.key}
                href={tool.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t(`tools.${tool.key}.name`)} (${t("opensInNewTab")})`}
                aria-describedby={describedBy}
                className={`flex items-start gap-3 ${primary ? "p-3.5" : "p-3"} rounded-xl border text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    primary
                        ? "border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/40"
                        : "border-neutral-200/70 dark:border-white/[0.06] bg-transparent hover:bg-neutral-50 dark:hover:bg-white/[0.03]"
                }`}
            >
                <div className={`rounded-lg flex items-center justify-center shrink-0 ${primary ? "w-9 h-9 bg-indigo-500/10 text-indigo-500" : "w-8 h-8 bg-neutral-100 dark:bg-white/10 text-muted-foreground"}`}>
                    <Icon size={primary ? 18 : 15} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className={`font-medium text-foreground ${primary ? "text-sm" : "text-[13px]"}`}>{t(`tools.${tool.key}.name`)}</p>
                    {primary && <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t(`tools.${tool.key}.desc`)}</p>}
                    {briefed && (
                        <dl id={describedBy} className="mt-2 space-y-1">
                            {BRIEF_FACETS.map((facet) => (
                                <div key={facet} className="flex gap-1.5 text-[11px] leading-snug">
                                    <dt className="shrink-0 font-medium text-foreground/70">{t(`briefLabels.${facet}`)}</dt>
                                    <dd className="min-w-0 text-muted-foreground">{t(`tools.${tool.key}.${facet}`)}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
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
