/**
 * Settings — single source of truth.
 *
 * Both the hub page (cards grid) and the sidebar layout consume this config.
 * Adding/removing/moving an item happens in ONE place.
 *
 * Visibility predicates use useRole():
 *   - canManageBilling → tenant_admin (or super_admin impersonating)
 *   - isSupervisor → supervisor or above
 *   - canManagePlatform → super_admin in platform mode
 */

import type { LucideIcon } from "lucide-react";
import {
    User, Shield, Bell, Palette, Building2, Globe, Clock,
    Database, Zap, MessageSquare, Mail, Image as ImageIcon, Brain,
    SlidersHorizontal, Settings, Info, Scale, RotateCcw, Phone,
    BellRing, GitBranch, BarChart2, Plug, CalendarCheck, Webhook, MessageCircle,
    RefreshCw, Sparkles, Key, Slack, Plug2, Star, Receipt, ShoppingBag,
} from "lucide-react";

export type Role = {
    canManageBilling: boolean;
    isSupervisor: boolean;
    canManagePlatform: boolean;
    isSuperAdminPlatformMode: boolean;
};

export interface SettingItem {
    key: string;
    href: string;
    icon: LucideIcon;
    iconColor: string;
    iconBg: string;
    /** Whether this item is visible based on role. Default: visible to all. */
    visible?: (r: Role) => boolean;
}

export interface SettingSection {
    key: string;
    items: SettingItem[];
    visible?: (r: Role) => boolean;
}

export const SETTINGS_SECTIONS: SettingSection[] = [
    // ── Account — visible to everyone (their own profile / security) ──
    {
        key: "account",
        items: [
            { key: "profile", href: "/admin/settings/profile", icon: User, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
            { key: "security", href: "/admin/settings/security", icon: Shield, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
            { key: "notifications", href: "/admin/settings/notifications", icon: Bell, iconColor: "text-rose-500", iconBg: "bg-rose-500/10" },
            { key: "appearance", href: "/admin/settings/appearance", icon: Palette, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
        ],
    },
    // ── Company — admin only (tenant-wide identity), hidden for super_admin in platform mode ──
    {
        key: "company",
        visible: (r) => r.canManageBilling && !r.isSuperAdminPlatformMode,
        items: [
            { key: "businessInfo", href: "/admin/settings/business-info", icon: Building2, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
            { key: "policies", href: "/admin/settings/policies", icon: Scale, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
            { key: "localization", href: "/admin/settings/localization", icon: Globe, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
            { key: "fiscal", href: "/admin/settings/fiscal", icon: Receipt, iconColor: "text-teal-500", iconBg: "bg-teal-500/10", visible: (r) => r.canManageBilling },
            { key: "businessHours", href: "/admin/settings/business-hours", icon: Clock, iconColor: "text-sky-500", iconBg: "bg-sky-500/10" },
        ],
    },
    // ── Operations — supervisor+ but hidden for super_admin in platform mode ──
    {
        key: "operations",
        visible: (r) => r.isSupervisor && !r.isSuperAdminPlatformMode,
        items: [
            { key: "pipelineStages", href: "/admin/settings/pipeline", icon: GitBranch, iconColor: "text-cyan-500", iconBg: "bg-cyan-500/10" },
            { key: "scoringConfig", href: "/admin/settings/scoring-config", icon: BarChart2, iconColor: "text-fuchsia-500", iconBg: "bg-fuchsia-500/10" },
            { key: "customAttributes", href: "/admin/settings/custom-attributes", icon: Database, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
            { key: "prechat", href: "/admin/settings/prechat", icon: MessageSquare, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
            { key: "publicBooking", href: "/admin/settings/public-booking", icon: CalendarCheck, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
            { key: "nurturing", href: "/admin/settings/nurturing", icon: RefreshCw, iconColor: "text-amber-500", iconBg: "bg-amber-500/10", visible: (r) => r.canManageBilling },
        ],
    },
    // ── Communication — supervisor+ but hidden for super_admin in platform mode ──
    {
        key: "communication",
        visible: (r) => r.isSupervisor && !r.isSuperAdminPlatformMode,
        items: [
            { key: "emailTemplates", href: "/admin/settings/email-templates", icon: Mail, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
            { key: "macros", href: "/admin/settings/macros", icon: Zap, iconColor: "text-orange-500", iconBg: "bg-orange-500/10" },
            { key: "mediaBank", href: "/admin/settings/media", icon: ImageIcon, iconColor: "text-pink-500", iconBg: "bg-pink-500/10" },
            { key: "recall", href: "/admin/settings/recall", icon: RotateCcw, iconColor: "text-cyan-500", iconBg: "bg-cyan-500/10", visible: (r) => r.canManageBilling },
        ],
    },
    // ── Integrations & alerts — admin only, hidden for super_admin in platform mode ──
    {
        key: "integrations",
        visible: (r) => r.canManageBilling && !r.isSuperAdminPlatformMode,
        items: [
            { key: "crmIntegrations", href: "/admin/settings/integrations/crm", icon: Plug, iconColor: "text-violet-500", iconBg: "bg-violet-500/10" },
            { key: "outboundWebhooks", href: "/admin/settings/integrations/webhooks", icon: Webhook, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
            { key: "webChat", href: "/admin/settings/integrations/web-chat", icon: MessageCircle, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
            { key: "slack", href: "/admin/settings/integrations/slack", icon: Slack, iconColor: "text-fuchsia-500", iconBg: "bg-fuchsia-500/10" },
            { key: "smsNotifications", href: "/admin/settings/integrations/sms-notifications", icon: MessageSquare, iconColor: "text-green-500", iconBg: "bg-green-500/10" },
            { key: "verticalIntegrations", href: "/admin/settings/integrations/vertical", icon: Plug, iconColor: "text-orange-500", iconBg: "bg-orange-500/10" },
            { key: "mcp", href: "/admin/settings/integrations/mcp", icon: Plug2, iconColor: "text-cyan-500", iconBg: "bg-cyan-500/10" },
            { key: "reviews", href: "/admin/settings/integrations/reviews", icon: Star, iconColor: "text-yellow-500", iconBg: "bg-yellow-500/10" },
            // Faltaba: el editor de agente ya dejaba encender las tools de
            // e-commerce y no había dónde conectar la tienda.
            { key: "ecommerce", href: "/admin/settings/integrations/ecommerce", icon: ShoppingBag, iconColor: "text-pink-500", iconBg: "bg-pink-500/10" },
            { key: "apiKeys", href: "/admin/settings/api-keys", icon: Key, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
            { key: "alerts", href: "/admin/settings/alerts", icon: BellRing, iconColor: "text-rose-500", iconBg: "bg-rose-500/10" },
        ],
    },
    // ── AI advanced — super_admin only ──
    {
        key: "aiAdvanced",
        visible: (r) => r.canManagePlatform,
        items: [
            { key: "aiProviders", href: "/admin/settings/ai-providers", icon: Brain, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
            { key: "aiConfig", href: "/admin/settings/ai-config", icon: SlidersHorizontal, iconColor: "text-violet-500", iconBg: "bg-violet-500/10" },
        ],
    },
    // ── Platform — super_admin only ──
    {
        key: "platform",
        visible: (r) => r.canManagePlatform,
        items: [
            { key: "channelConfig", href: "/admin/settings/channels", icon: Phone, iconColor: "text-green-500", iconBg: "bg-green-500/10" },
            { key: "changelog", href: "/admin/settings/platform/changelog", icon: Sparkles, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
            { key: "advanced", href: "/admin/settings/platform", icon: Settings, iconColor: "text-neutral-500", iconBg: "bg-neutral-500/10" },
        ],
    },
];

/** Filter sections + items by role. Removes empty sections. */
export function getVisibleSections(role: Role): SettingSection[] {
    return SETTINGS_SECTIONS
        .filter((s) => !s.visible || s.visible(role))
        .map((s) => ({
            ...s,
            items: s.items.filter((i) => !i.visible || i.visible(role)),
        }))
        .filter((s) => s.items.length > 0);
}
