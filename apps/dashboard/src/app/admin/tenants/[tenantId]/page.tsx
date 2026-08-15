"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import Link from "next/link";
import TenantAdminActions from "../_components/TenantAdminActions";
import TenantActivityFeed from "../_components/TenantActivityFeed";
import TenantVerticalActivity from "../_components/TenantVerticalActivity";
import TenantQuotaOverrides from "../_components/TenantQuotaOverrides";
import TenantMediaStats from "../_components/TenantMediaStats";
import TenantFeatureFlags from "../_components/TenantFeatureFlags";
import {
  Building2, Info, Users, Radio, CreditCard, ChevronRight, KeyRound,
  X, CheckCircle, Edit, Activity, Cpu, MessageSquare, Headphones,
  Bot, HelpCircle, CalendarDays, Plug, Tag,
} from "lucide-react";

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  industry: string;
  language: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  subscriptionStatus?: string;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  /** Tenant nuestro: sin factura DIAN y fuera de las métricas de ingresos. */
  isInternal?: boolean;
}

interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface ChannelAccount {
  id: string;
  channelType: string;
  accountName?: string;
  isActive: boolean;
  createdAt: string;
}

interface EngagementData {
  healthScore: number;
  messages7d: number;
  messages30d: number;
  activeConversations: number;
  pendingHandoffs: number;
  agentsCount: number;
  faqsCount: number;
  servicesCount: number;
  channelsConnected: number;
  industry: string;
  subType: string;
  agents: {
    id: string;
    name: string;
    templateName?: string;
    channels: string[];
    isDefault: boolean;
  }[];
  pipelineStages: {
    name: string;
    color: string;
    position: number;
  }[];
}

type TabId = "info" | "users" | "channels" | "billing" | "engagement" | "aiConfig";

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trialing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  past_due: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  expired: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  cancelled: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
  suspended: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const planColor: Record<string, string> = {
  emprendedor: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  starter: "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300",
  professional: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  pro: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  enterprise: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  custom: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

const roleLabel: Record<string, string> = {
  super_admin: "Super Admin",
  tenant_admin: "Admin",
  tenant_supervisor: "Supervisor",
  tenant_agent: "Agent",
};

const channelColors: Record<string, string> = {
  whatsapp: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  instagram: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  messenger: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  telegram: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  sms: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
};

export default function TenantDetailPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const t = useTranslations("tenants");
  const tc = useTranslations("common");

  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("info");
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [channels, setChannels] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(false);
  const [engagementLoaded, setEngagementLoaded] = useState(false);

  // Password reset
  const [resetUser, setResetUser] = useState<TenantUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);

    setNotFound(false);
    Promise.all([
      api.getTenant(tenantId),
      api.getTenantUsers(tenantId),
    ]).then(([tenantRes, usersRes]) => {
      if (tenantRes.success && tenantRes.data) {
        const d = tenantRes.data as any;
        setTenant({
          id: d.id,
          name: d.name,
          slug: d.slug,
          industry: d.industry ? d.industry.replace(/^tenants\.industries\./, "") : "N/A",
          language: d.language || "es-CO",
          plan: d.plan || "starter",
          isActive: d.isActive ?? true,
          createdAt: d.createdAt || "",
          subscriptionStatus: d.subscriptionStatus || (d.isActive ? "active" : "cancelled"),
          currentPeriodEnd: d.currentPeriodEnd || null,
          trialEndsAt: d.trialEndsAt || null,
          isInternal: d.isInternal === true,
        });
        // Extract channels from tenant data if available
        if (d.channelAccounts) {
          setChannels(
            d.channelAccounts.map((ch: any) => ({
              id: ch.id,
              channelType: ch.channelType || ch.channel_type || "unknown",
              accountName: ch.displayName || ch.accountName || ch.account_name || ch.name || "",
              isActive: ch.isActive ?? true,
              createdAt: ch.createdAt || "",
            }))
          );
        }
      }
      else {
        // Tenant fetch failed (e.g. it was just purged, or a stale URL). Show a
        // not-found state instead of hanging on the "Cargando…" title fallback.
        setNotFound(true);
      }
      if (usersRes.success && Array.isArray(usersRes.data)) {
        setUsers(usersRes.data);
      }
      setLoading(false);
    });
  }, [tenantId]);

  // Lazy-load engagement data when tab is selected
  useEffect(() => {
    if ((activeTab === "engagement" || activeTab === "aiConfig") && !engagementLoaded && tenantId) {
      setEngagementLoading(true);
      api.getTenantEngagement(tenantId).then((res: any) => {
        if (res.success && res.data) {
          const d = res.data;
          if (d.industry) {
            d.industry = d.industry.replace(/^tenants\.industries\./, "");
          }
          setEngagement(d);
        }
        setEngagementLoaded(true);
        setEngagementLoading(false);
      }).catch(() => {
        setEngagementLoaded(true);
        setEngagementLoading(false);
      });
    }
  }, [activeTab, engagementLoaded, tenantId]);

  const handleResetPassword = async () => {
    if (!resetUser || !newPassword || newPassword.length < 6) return;
    setResettingPassword(true);
    try {
      const result = await api.adminResetPassword(resetUser.id, newPassword);
      if (result.success) {
        showToast(`Password reset for ${resetUser.email}`);
        setResetUser(null);
        setNewPassword("");
      } else {
        showToast(result.error || tc("errorSaving"));
      }
    } catch {
      showToast(tc("connectionError"));
    }
    setResettingPassword(false);
  };

  const tabs = [
    { id: "info" as const, label: t("detail.info"), icon: Info },
    { id: "users" as const, label: t("detail.users"), icon: Users },
    { id: "channels" as const, label: t("detail.channels"), icon: Radio },
    { id: "billing" as const, label: t("detail.billing"), icon: CreditCard },
    { id: "engagement" as const, label: t("tabs.engagement"), icon: Activity },
    { id: "aiConfig" as const, label: t("tabs.aiConfig"), icon: Cpu },
  ];

  const status = tenant?.subscriptionStatus || "active";

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <PageHeader
        title={tenant?.name || (notFound ? t("detail.notFoundTitle") : tc("loading"))}
        subtitle={tenant?.slug}
        icon={Building2}
        breadcrumbs={
          <nav className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400">
            <Link href="/admin/tenants" className="hover:text-neutral-700 dark:hover:text-neutral-300 no-underline text-neutral-500 dark:text-neutral-400">
              {t("title")}
            </Link>
            <ChevronRight size={14} />
            <span className="text-neutral-900 dark:text-neutral-100">
              {tenant?.name || (notFound ? t("detail.notFoundTitle") : "...")}
            </span>
          </nav>
        }
        badge={
          tenant ? (
            <div className="flex items-center gap-2">
              <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", statusColor[status] || statusColor.active)}>
                {t(`status.${status}`)}
              </span>
              <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", planColor[tenant.plan] || planColor.starter)}>
                {tenant.plan}
              </span>
            </div>
          ) : undefined
        }
      />

      <TabNav tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as TabId)} />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Tenant gone (purged) or stale URL — don't hang on the loading title */}
      {!loading && notFound && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-neutral-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("detail.notFoundTitle")}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("detail.notFoundHint")}</p>
          </div>
          <Link
            href="/admin/tenants"
            className="mt-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium no-underline transition-colors"
          >
            {t("detail.backToList")}
          </Link>
        </div>
      )}

      {/* INFO TAB */}
      {!loading && !notFound && activeTab === "info" && tenant && (
        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("detail.companyDetails")}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: t("modals.name"), value: tenant.name },
                { label: "Slug", value: tenant.slug },
                { label: t("industry"), value: tenant.industry && tenant.industry !== "N/A" ? t(`industries.${tenant.industry}`, { defaultValue: tenant.industry.replace(/_/g, " ") }) : "--" },
                { label: t("modals.language"), value: tenant.language },
                { label: t("plan"), value: tenant.plan },
                { label: t("table.created"), value: tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "--" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-0.5">{item.label}</div>
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Super-admin actions: extend trial / suspend / reactivate / purge */}
          <TenantAdminActions
            tenant={{
              id: tenant.id,
              name: tenant.name,
              slug: tenant.slug,
              isActive: tenant.isActive,
              subscriptionStatus: tenant.subscriptionStatus,
              plan: tenant.plan,
              isInternal: tenant.isInternal,
            }}
            onChange={() => {
              // Refetch tenant detail after status change
              if (typeof window !== "undefined") window.location.reload();
            }}
            onPurged={(stranded) => {
              // The tenant no longer exists — reloading this page would 404 and
              // hang on "Cargando…". Go back to the list, which shows the toast.
              try {
                sessionStorage.setItem("tenantPurged", tenant.name);
                // A mandate we could not cancel outlives the tenant, so the
                // notice has to outlive this page too. The list renders it as a
                // banner that stays put — a toast would vanish before the id
                // could be copied, and the id is the whole point.
                if (stranded) {
                  sessionStorage.setItem(
                    "tenantPurgedStrandedMandate",
                    JSON.stringify({ ...stranded, tenantName: tenant.name }),
                  );
                }
              } catch { /* noop */ }
              router.push("/admin/tenants");
            }}
          />

          {/* Per-tenant quota overrides (rate limits + feature limits) */}
          <TenantQuotaOverrides tenantId={tenant.id} />

          {/* Media processing usage (audio transcription + image vision) */}
          <TenantMediaStats tenantId={tenant.id} />

          {/* Per-tenant feature flags */}
          <TenantFeatureFlags tenantId={tenant.id} />

          {/* Vertical-specific KPIs (visible only when tenant has data in its industry) */}
          <TenantVerticalActivity tenantId={tenant.id} />

          {/* Last 10 admin actions for this tenant */}
          <TenantActivityFeed tenantId={tenant.id} />
        </div>
      )}

      {/* USERS TAB */}
      {!loading && activeTab === "users" && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("modals.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.email")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.role")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.statusCol")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.created")}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                      {user.firstName} {user.lastName}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400 text-xs">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        {roleLabel[user.role] || user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded-md text-xs font-medium",
                        user.isActive ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
                      )}>
                        {user.isActive ? tc("active") : tc("inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500 text-xs">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "--"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { setResetUser(user); setNewPassword(""); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700"
                      >
                        <KeyRound size={13} /> {t("actions.resetPassword")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <div className="py-12 text-center text-neutral-500 text-sm">{t("detail.noUsers")}</div>
            )}
          </div>
        </div>
      )}

      {/* CHANNELS TAB */}
      {!loading && activeTab === "channels" && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.type")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("modals.name")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.statusCol")}</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">{t("table.connectedAt")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {channels.map((ch) => (
                  <tr key={ch.id}>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium", channelColors[ch.channelType] || channelColors.sms)}>
                        {ch.channelType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-900 dark:text-neutral-100">{ch.accountName || "--"}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded-md text-xs font-medium",
                        ch.isActive ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400"
                      )}>
                        {ch.isActive ? tc("active") : tc("inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500 text-xs">
                      {ch.createdAt ? new Date(ch.createdAt).toLocaleDateString() : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {channels.length === 0 && (
              <div className="py-12 text-center text-neutral-500 text-sm">{t("detail.noChannels")}</div>
            )}
          </div>
        </div>
      )}

      {/* BILLING TAB */}
      {!loading && activeTab === "billing" && tenant && (
        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("detail.subscriptionStatus")}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: t("table.statusCol"), value: status },
                { label: t("plan"), value: tenant.plan },
                { label: t("detail.trialEnd"), value: tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleDateString() : "--" },
                { label: t("table.periodEnd"), value: tenant.currentPeriodEnd ? new Date(tenant.currentPeriodEnd).toLocaleDateString() : "--" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-0.5">{item.label}</div>
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ENGAGEMENT TAB */}
      {!loading && activeTab === "engagement" && (
        <div className="space-y-6">
          {engagementLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!engagementLoading && engagement && (
            <>
              {/* Health Score + Industry */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 flex flex-col items-center justify-center">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">{t("engagement.healthScore")}</p>
                  <div className={cn(
                    "w-24 h-24 rounded-full border-4 flex items-center justify-center",
                    engagement.healthScore >= 60
                      ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                      : engagement.healthScore >= 30
                        ? "border-amber-500 text-amber-600 dark:text-amber-400"
                        : "border-red-500 text-red-600 dark:text-red-400"
                  )}>
                    <span className="text-3xl font-semibold tabular-nums">{engagement.healthScore}</span>
                  </div>
                  <p className={cn(
                    "text-xs font-medium mt-2",
                    engagement.healthScore >= 60
                      ? "text-emerald-600 dark:text-emerald-400"
                      : engagement.healthScore >= 30
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                  )}>
                    {engagement.healthScore >= 60
                      ? t("engagement.healthy")
                      : engagement.healthScore >= 30
                        ? t("engagement.needsAttention")
                        : t("engagement.dormant")}
                  </p>
                </div>

                <div className="lg:col-span-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">{t("engagement.vertical")}</h3>
                  <div className="flex flex-wrap gap-2">
                    {engagement.industry && (
                      <span className="px-3 py-1 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                        {t(`industries.${engagement.industry}`, { defaultValue: engagement.industry })}
                      </span>
                    )}
                    {engagement.subType && (
                      <span className="px-3 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400">
                        {engagement.subType}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">{t("engagement.subType")}</p>
                </div>
              </div>

              {/* Activity KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: t("engagement.messages7d"), value: engagement.messages7d, icon: MessageSquare, color: "text-blue-500", bg: "bg-blue-500/10" },
                  { label: t("engagement.messages30d"), value: engagement.messages30d, icon: MessageSquare, color: "text-indigo-500", bg: "bg-indigo-500/10" },
                  { label: t("engagement.activeConversations"), value: engagement.activeConversations, icon: Activity, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                  { label: t("engagement.pendingHandoffs"), value: engagement.pendingHandoffs, icon: Headphones, color: "text-amber-500", bg: "bg-amber-500/10" },
                ].map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <div key={kpi.label} className="flex items-start justify-between p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                      <div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{kpi.label}</p>
                        <p className="text-2xl font-semibold tabular-nums">{kpi.value}</p>
                      </div>
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", kpi.bg)}>
                        <Icon size={20} className={kpi.color} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Configuration KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: t("engagement.agents"), value: engagement.agentsCount, icon: Bot, color: "text-purple-500", bg: "bg-purple-500/10" },
                  { label: t("engagement.faqs"), value: engagement.faqsCount, icon: HelpCircle, color: "text-cyan-500", bg: "bg-cyan-500/10" },
                  { label: t("engagement.services"), value: engagement.servicesCount, icon: CalendarDays, color: "text-pink-500", bg: "bg-pink-500/10" },
                  { label: t("engagement.channels"), value: engagement.channelsConnected, icon: Plug, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                ].map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <div key={kpi.label} className="flex items-start justify-between p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                      <div>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{kpi.label}</p>
                        <p className="text-2xl font-semibold tabular-nums">{kpi.value}</p>
                      </div>
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", kpi.bg)}>
                        <Icon size={20} className={kpi.color} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {!engagementLoading && !engagement && engagementLoaded && (
            <div className="py-12 text-center text-neutral-500 text-sm">{tc("noResults")}</div>
          )}
        </div>
      )}

      {/* AI CONFIG TAB */}
      {!loading && activeTab === "aiConfig" && (
        <div className="space-y-6">
          {engagementLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!engagementLoading && engagement && (
            <>
              {/* Vertical info */}
              {engagement.industry && (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">{t("engagement.vertical")}</h3>
                  <span className="px-3 py-1 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    {t(`industries.${engagement.industry}`, { defaultValue: engagement.industry })}
                  </span>
                </div>
              )}

              {/* Agents list */}
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("engagement.agents")}</h3>
                {(engagement.agents?.length ?? 0) === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">{tc("noResults")}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(engagement.agents ?? []).map((agent) => (
                      <div
                        key={agent.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                          <Bot size={18} className="text-purple-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{agent.name}</span>
                            {agent.isDefault && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                Default
                              </span>
                            )}
                          </div>
                          {agent.templateName && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{agent.templateName}</p>
                          )}
                          {agent.channels.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {agent.channels.map((ch) => (
                                <span
                                  key={ch}
                                  className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", channelColors[ch] || channelColors.sms)}
                                >
                                  {ch}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pipeline stages */}
              {(engagement.pipelineStages?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("engagement.pipelineStages")}</h3>
                  <div className="flex flex-wrap gap-2">
                    {[...(engagement.pipelineStages ?? [])]
                      .sort((a, b) => a.position - b.position)
                      .map((stage, i) => (
                        <span
                          key={i}
                          className="px-3 py-1.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: stage.color || "#6c5ce7" }}
                        >
                          {stage.name}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
          {!engagementLoading && !engagement && engagementLoaded && (
            <div className="py-12 text-center text-neutral-500 text-sm">{tc("noResults")}</div>
          )}
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={() => setResetUser(null)}>
          <div className="w-[440px] max-w-[90vw] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("actions.resetPassword")}</h2>
              <button onClick={() => setResetUser(null)} className="bg-transparent border-none text-neutral-500 cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
              User: <strong className="text-neutral-900 dark:text-neutral-100">{resetUser.firstName} {resetUser.lastName}</strong>
              <br />
              Email: <strong className="text-neutral-900 dark:text-neutral-100">{resetUser.email}</strong>
            </p>
            <div className="mb-5">
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">New password</label>
              <input
                type="password"
                placeholder="Minimum 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setResetUser(null)} className="px-4 py-2 rounded-lg text-sm font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer">
                {tc("cancel")}
              </button>
              <button
                onClick={handleResetPassword}
                disabled={newPassword.length < 6 || resettingPassword}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 cursor-pointer hover:opacity-90 disabled:opacity-50 border-none"
              >
                {resettingPassword ? tc("saving") : t("actions.resetPassword")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle size={16} className="text-emerald-400 dark:text-emerald-600" />
          {toast}
        </div>
      )}
    </div>
  );
}
