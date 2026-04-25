"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import Link from "next/link";
import {
  Building2, Info, Users, Radio, CreditCard, ChevronRight, KeyRound,
  X, CheckCircle, Edit,
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

type TabId = "info" | "users" | "channels" | "billing";

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trialing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  past_due: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cancelled: "bg-neutral-500/10 text-neutral-600 dark:text-neutral-400",
  suspended: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const planColor: Record<string, string> = {
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

  const [activeTab, setActiveTab] = useState<TabId>("info");
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [channels, setChannels] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);

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
          industry: d.industry || "N/A",
          language: d.language || "es-CO",
          plan: d.plan || "starter",
          isActive: d.isActive ?? true,
          createdAt: d.createdAt || "",
          subscriptionStatus: d.subscriptionStatus || (d.isActive ? "active" : "cancelled"),
          currentPeriodEnd: d.currentPeriodEnd || null,
          trialEndsAt: d.trialEndsAt || null,
        });
        // Extract channels from tenant data if available
        if (d.channelAccounts) {
          setChannels(
            d.channelAccounts.map((ch: any) => ({
              id: ch.id,
              channelType: ch.channelType || ch.channel_type || "unknown",
              accountName: ch.accountName || ch.account_name || ch.name || "",
              isActive: ch.isActive ?? true,
              createdAt: ch.createdAt || "",
            }))
          );
        }
      }
      if (usersRes.success && Array.isArray(usersRes.data)) {
        setUsers(usersRes.data);
      }
      setLoading(false);
    });
  }, [tenantId]);

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
  ];

  const status = tenant?.subscriptionStatus || "active";

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <PageHeader
        title={tenant?.name || tc("loading")}
        subtitle={tenant?.slug}
        icon={Building2}
        breadcrumbs={
          <nav className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400">
            <Link href="/admin/tenants" className="hover:text-neutral-700 dark:hover:text-neutral-300 no-underline text-neutral-500 dark:text-neutral-400">
              {t("title")}
            </Link>
            <ChevronRight size={14} />
            <span className="text-neutral-900 dark:text-neutral-100">{tenant?.name || "..."}</span>
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

      {/* INFO TAB */}
      {!loading && activeTab === "info" && tenant && (
        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("detail.companyDetails")}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: t("modals.name"), value: tenant.name },
                { label: "Slug", value: tenant.slug },
                { label: t("industry"), value: tenant.industry },
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
