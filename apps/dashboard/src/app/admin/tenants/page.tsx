"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import {
  Building2, Plus, LayoutGrid, UserPlus, UserMinus,
  CreditCard, BarChart3, Server, CheckCircle,
} from "lucide-react";
import TenantsOverviewTab from "./_components/TenantsOverviewTab";
import OnboardingTab from "./_components/OnboardingTab";
import OffboardingTab from "./_components/OffboardingTab";
import BillingTab from "./_components/BillingTab";
import UsageTab from "./_components/UsageTab";
import PlatformTab from "./_components/PlatformTab";
import CreateTenantModal from "./_components/CreateTenantModal";
import EditTenantModal from "./_components/EditTenantModal";
import SuspendModal from "./_components/SuspendModal";
import type { Tenant, PlatformStats, PlatformBilling, PlatformUsage, PlatformHealth } from "./_components/types";

type TabId = "overview" | "onboarding" | "offboarding" | "billing" | "usage" | "platform";

export default function TenantsPage() {
  const t = useTranslations("tenants");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [billing, setBilling] = useState<PlatformBilling | null>(null);
  const [usage, setUsage] = useState<PlatformUsage | null>(null);
  const [health, setHealth] = useState<PlatformHealth | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editTenant, setEditTenant] = useState<Tenant | null>(null);
  const [suspendTenant, setSuspendTenant] = useState<Tenant | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Load tenants
  const loadTenants = useCallback(async () => {
    const result = await api.getTenants();
    if (result.success && Array.isArray(result.data)) {
      setTenants(
        result.data.map((t: any) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          industry: t.industry || "N/A",
          language: t.language || "es-CO",
          plan: t.plan || "starter",
          isActive: t.isActive ?? true,
          createdAt: t.createdAt || "",
          channels: t._count?.channelAccounts || 0,
          conversations: 0,
          users: t._count?.users || 0,
          subscriptionStatus: t.subscriptionStatus || (t.isActive ? "active" : "cancelled"),
          currentPeriodEnd: t.currentPeriodEnd || null,
          trialEndsAt: t.trialEndsAt || null,
          onboardingCompleted: t.onboardingCompleted ?? false,
          suspendedAt: t.suspendedAt || null,
          suspendReason: t.suspendReason || null,
        }))
      );
    }
  }, []);

  // Load platform data
  const loadPlatformData = useCallback(async () => {
    const [statsRes, billingRes, usageRes, healthRes] = await Promise.allSettled([
      api.getPlatformStats(),
      api.getPlatformBilling(),
      api.getPlatformUsage(),
      api.getPlatformHealth(),
    ]);
    if (statsRes.status === "fulfilled" && statsRes.value.success) setStats(statsRes.value.data ?? null);
    if (billingRes.status === "fulfilled" && billingRes.value.success) setBilling(billingRes.value.data ?? null);
    if (usageRes.status === "fulfilled" && usageRes.value.success) setUsage(usageRes.value.data ?? null);
    if (healthRes.status === "fulfilled" && healthRes.value.success) setHealth(healthRes.value.data ?? null);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadTenants(), loadPlatformData()]).finally(() => setLoading(false));
  }, [loadTenants, loadPlatformData]);

  // Actions
  const handleCreate = async (data: { name: string; slug: string; industry: string; language: string; plan: string }) => {
    const result = await api.createTenant(data);
    if (result.success) {
      showToast(`${data.name} created`);
      setShowCreate(false);
      loadTenants();
    } else {
      showToast(result.error || tc("errorSaving"));
    }
  };

  const handleEdit = async (tenantId: string, data: { name: string; industry: string; language: string; plan: string }) => {
    const result = await api.updateTenant(tenantId, data);
    if (result.success) {
      showToast(tc("saved"));
      setEditTenant(null);
      loadTenants();
    } else {
      showToast(result.error || tc("errorSaving"));
    }
  };

  const handleSuspend = async (tenantId: string, reason: string) => {
    const result = await api.suspendTenant(tenantId, reason);
    if (result.success) {
      showToast(t("actions.suspend") + " - OK");
      setSuspendTenant(null);
      loadTenants();
    } else {
      showToast(result.error || tc("errorSaving"));
    }
  };

  const handleReactivate = async (tenantId: string) => {
    const result = await api.reactivateTenant(tenantId);
    if (result.success) {
      showToast(t("actions.reactivate") + " - OK");
      loadTenants();
    } else {
      showToast(result.error || tc("errorSaving"));
    }
  };

  const handleImpersonate = async (tenant: Tenant) => {
    const result = await api.impersonateTenant(tenant.id);
    if (result.success && result.data) {
      const data = result.data as any;
      // Store impersonation state
      localStorage.setItem("impersonation", JSON.stringify({
        originalAccessToken: localStorage.getItem("accessToken"),
        originalRefreshToken: localStorage.getItem("refreshToken"),
        originalUser: localStorage.getItem("user"),
        tenantName: tenant.name,
      }));
      // Replace tokens with impersonated ones
      if (data.accessToken) localStorage.setItem("accessToken", data.accessToken);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
      // Reload to apply
      window.location.href = "/admin";
    } else {
      showToast(result.error || "Impersonation failed");
    }
  };

  const tabs = [
    { id: "overview" as const, label: t("tabs.overview"), icon: LayoutGrid },
    { id: "onboarding" as const, label: t("tabs.onboarding"), icon: UserPlus },
    { id: "offboarding" as const, label: t("tabs.offboarding"), icon: UserMinus },
    { id: "billing" as const, label: t("tabs.billing"), icon: CreditCard },
    { id: "usage" as const, label: t("tabs.usage"), icon: BarChart3 },
    { id: "platform" as const, label: t("tabs.platform"), icon: Server },
  ];

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        icon={Building2}
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect border-none"
          >
            <Plus size={16} /> {t("newTenant")}
          </button>
        }
      />

      <TabNav tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as TabId)} />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{tc("loading")}</p>
          </div>
        </div>
      )}

      {!loading && activeTab === "overview" && (
        <TenantsOverviewTab
          tenants={tenants}
          stats={stats}
          onEdit={setEditTenant}
          onSuspend={setSuspendTenant}
          onImpersonate={handleImpersonate}
        />
      )}

      {!loading && activeTab === "onboarding" && (
        <OnboardingTab tenants={tenants} stats={stats} />
      )}

      {!loading && activeTab === "offboarding" && (
        <OffboardingTab
          tenants={tenants}
          onSuspend={setSuspendTenant}
          onReactivate={handleReactivate}
        />
      )}

      {!loading && activeTab === "billing" && (
        <BillingTab billing={billing} />
      )}

      {!loading && activeTab === "usage" && (
        <UsageTab usage={usage} />
      )}

      {!loading && activeTab === "platform" && (
        <PlatformTab health={health} />
      )}

      {/* Modals */}
      <CreateTenantModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      <EditTenantModal tenant={editTenant} onClose={() => setEditTenant(null)} onSave={handleEdit} />
      <SuspendModal tenant={suspendTenant} onClose={() => setSuspendTenant(null)} onSuspend={handleSuspend} />

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
