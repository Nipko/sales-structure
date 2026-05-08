"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { TabNav } from "@/components/ui/tab-nav";
import { SkeletonKPIs, SkeletonCards } from "@/components/ui/skeleton-loader";
import {
  BarChart3, LayoutGrid, DollarSign, Users, Server, Settings,
} from "lucide-react";
import OverviewTab from "./_components/OverviewTab";
import RevenueTab from "./_components/RevenueTab";
import CustomersTab from "./_components/CustomersTab";
import CostsTab from "./_components/CostsTab";
import SettingsTab from "./_components/SettingsTab";

type TabId = "overview" | "revenue" | "customers" | "costs" | "settings";

export default function FinancialsPage() {
  const t = useTranslations("financials");
  const tc = useTranslations("common");
  const tHelp = useTranslations("help");
  const { user } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [mrrTrend, setMrrTrend] = useState<any[]>([]);
  const [trialMetrics, setTrialMetrics] = useState<any>(null);
  const [revenueTrend, setRevenueTrend] = useState<any[]>([]);
  const [churnTrend, setChurnTrend] = useState<any[]>([]);
  const [costsTrend, setCostsTrend] = useState<any[]>([]);
  const [profitability, setProfitability] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [overviewRes, mrrRes, trialRes, revenueRes, churnRes, costsRes, profitRes] =
      await Promise.allSettled([
        api.getFinancialsOverview(),
        api.getMrrTrend(),
        api.getTrialMetrics(),
        api.getRevenueTrend(),
        api.getChurnTrend(),
        api.getCostsTrend(),
        api.getTenantProfitability(),
      ]);

    if (overviewRes.status === "fulfilled" && overviewRes.value.success)
      setOverview(overviewRes.value.data ?? null);
    if (mrrRes.status === "fulfilled" && mrrRes.value.success)
      setMrrTrend(mrrRes.value.data ?? []);
    if (trialRes.status === "fulfilled" && trialRes.value.success)
      setTrialMetrics(trialRes.value.data ?? null);
    if (revenueRes.status === "fulfilled" && revenueRes.value.success)
      setRevenueTrend(revenueRes.value.data ?? []);
    if (churnRes.status === "fulfilled" && churnRes.value.success)
      setChurnTrend(churnRes.value.data ?? []);
    if (costsRes.status === "fulfilled" && costsRes.value.success)
      setCostsTrend(costsRes.value.data ?? []);
    if (profitRes.status === "fulfilled" && profitRes.value.success)
      setProfitability(profitRes.value.data ?? []);

    setLoading(false);
  }, []);

  useEffect(() => {
    if (user?.role !== "super_admin") {
      router.push("/admin");
      return;
    }
    loadData();
  }, [user, router, loadData]);

  const tabs = [
    { id: "overview" as const, label: t("tabs.overview"), icon: LayoutGrid },
    { id: "revenue" as const, label: t("tabs.revenue"), icon: DollarSign },
    { id: "customers" as const, label: t("tabs.customers"), icon: Users },
    { id: "costs" as const, label: t("tabs.costs"), icon: Server },
    { id: "settings" as const, label: t("tabs.settings"), icon: Settings },
  ];

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        icon={BarChart3}
      />

      <HelpPanel
        title={tHelp("financials.title")}
        description={tHelp("financials.description")}
        tips={tHelp.raw("financials.tips") as string[]}
      />

      <TabNav tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as TabId)} />

      {loading && (
        <div className="space-y-6">
          <SkeletonKPIs count={4} />
          <SkeletonCards count={3} />
        </div>
      )}

      {!loading && activeTab === "overview" && (
        <OverviewTab overview={overview} mrrTrend={mrrTrend} />
      )}

      {!loading && activeTab === "revenue" && (
        <RevenueTab overview={overview} revenueTrend={revenueTrend} />
      )}

      {!loading && activeTab === "customers" && (
        <CustomersTab overview={overview} trialMetrics={trialMetrics} churnTrend={churnTrend} />
      )}

      {!loading && activeTab === "costs" && (
        <CostsTab overview={overview} costsTrend={costsTrend} profitability={profitability} />
      )}

      {!loading && activeTab === "settings" && (
        <SettingsTab onRefresh={loadData} />
      )}
    </div>
  );
}
