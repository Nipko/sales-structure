"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { UpgradeBanner, UpgradeModal } from "@/components/ui/upgrade-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  Plus,
  Pencil,
  Trash2,
  Users,
  Play,
  Pause,
  GitBranch,
  Activity,
  ListChecks,
  ChevronRight,
} from "lucide-react";

interface DripStep {
  delay_seconds: number;
  message_type: "template" | "ai_generated" | "custom";
  content: string;
  template_name?: string;
  stop_if: string[];
}

interface DripSequence {
  id: string;
  name: string;
  trigger_event: string;
  trigger_conditions: any;
  steps: DripStep[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  enrolled_count?: number;
}

const TRIGGER_MAP: Record<string, string> = {
  manual: "triggerManual",
  lead_captured: "triggerLeadCaptured",
  tag_added: "triggerTagAdded",
  stage_changed: "triggerStageChanged",
};

export default function DripSequencesPage() {
  const t = useTranslations("dripSequences");
  const tHelp = useTranslations("help");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();
  const { canCreate, getLimit } = usePlanLimits();
  const router = useRouter();

  const [sequences, setSequences] = useState<DripSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  useEffect(() => {
    loadSequences();
  }, [activeTenantId]);

  async function loadSequences() {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await api.listDripSequences(activeTenantId);
      if (res.success && Array.isArray(res.data)) {
        setSequences(res.data);
      }
    } catch (err) {
      console.error("Error loading drip sequences", err);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleToggle(id: string, currentActive: boolean) {
    const next = !currentActive;
    setSequences(prev => prev.map(s => s.id === id ? { ...s, is_active: next } : s));
    if (activeTenantId) {
      try {
        await api.toggleDripSequence(activeTenantId, id, next);
        showToast(next ? t("toast.enabled") : t("toast.disabled"));
      } catch {
        setSequences(prev => prev.map(s => s.id === id ? { ...s, is_active: currentActive } : s));
        showToast(t("toast.errorToggle"));
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    const backup = sequences;
    setSequences(prev => prev.filter(s => s.id !== id));
    if (activeTenantId) {
      try {
        await api.deleteDripSequence(activeTenantId, id);
        showToast(t("toast.deleted"));
      } catch {
        setSequences(backup);
        showToast(t("toast.errorDelete"));
      }
    }
  }

  function handleCreate() {
    if (!canCreate("automationRules", sequences.length)) {
      setUpgradeModalOpen(true);
      return;
    }
    router.push("/admin/automation/drip-sequences/new");
  }

  function handleEdit(id: string) {
    router.push(`/admin/automation/drip-sequences/${id}`);
  }

  const activeCount = sequences.filter(s => s.is_active).length;
  const totalEnrolled = sequences.reduce((sum, s) => sum + Number(s.enrolled_count || 0), 0);

  return (
    <div className="text-foreground">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        icon={Zap}
        iconColor="bg-indigo-500/10"
        action={
          <Button
            onClick={handleCreate}
            className="bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 gap-2 press-effect"
          >
            <Plus size={18} /> {t("newSequence")}
          </Button>
        }
      />

      <HelpPanel
        title={tHelp("dripSequences.title")}
        description={tHelp("dripSequences.description")}
        tips={tHelp.raw("dripSequences.tips") as string[]}
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          {
            key: "total",
            label: t("stats.total"),
            value: sequences.length,
            icon: GitBranch,
            color: "#6c5ce7",
            bg: "bg-indigo-600/10",
          },
          {
            key: "active",
            label: t("stats.active"),
            value: activeCount,
            icon: Activity,
            color: "#00d68f",
            bg: "bg-emerald-500/10",
          },
          {
            key: "enrolled",
            label: t("stats.enrolled"),
            value: totalEnrolled,
            icon: Users,
            color: "#ffaa00",
            bg: "bg-amber-500/10",
          },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <Card key={stat.key} className="border-border bg-card">
              <CardContent className="flex items-center gap-3.5 p-4">
                <div className={cn("w-[42px] h-[42px] rounded-[10px] flex items-center justify-center", stat.bg)}>
                  <Icon size={20} color={stat.color} />
                </div>
                <div>
                  <div className="text-[22px] font-semibold">{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <UpgradeBanner
        current={sequences.length}
        limit={getLimit("automationRules")}
        resourceLabel={t("resourceLabel")}
      />

      {loading ? (
        <div className="text-center p-10 text-muted-foreground">{t("loading")}</div>
      ) : sequences.length === 0 ? (
        <EmptyState
          icon={Zap}
          iconColor="text-indigo-400"
          title={t("empty.title")}
          description={t("empty.subtitle")}
          action={
            <Button
              onClick={handleCreate}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
            >
              <Plus size={16} /> {t("newSequence")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {sequences.map(seq => (
            <Card
              key={seq.id}
              className={cn(
                "border-border bg-card transition-opacity duration-200",
                !seq.is_active && "opacity-55"
              )}
            >
              <CardContent className="flex justify-between items-center p-4 px-5">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full flex-shrink-0",
                    seq.is_active ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-600"
                  )} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[15px] truncate">{seq.name}</span>
                      <Badge
                        variant="secondary"
                        className="bg-indigo-600/15 text-indigo-600 dark:text-indigo-400 text-[10px] px-2 py-0.5 font-semibold"
                      >
                        {t(TRIGGER_MAP[seq.trigger_event] || "triggerManual")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ListChecks size={12} />
                        {t("stepsCount", { count: seq.steps?.length || 0 })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {t("enrolledCount", { count: seq.enrolled_count || 0 })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 items-center flex-shrink-0">
                  <button
                    onClick={() => handleToggle(seq.id, seq.is_active)}
                    className={cn(
                      "w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-200",
                      seq.is_active ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                    )}
                  >
                    <div className={cn(
                      "w-[18px] h-[18px] rounded-full bg-white absolute top-[3px] transition-[left] duration-200 shadow-sm",
                      seq.is_active ? "left-[23px]" : "left-[3px]"
                    )} />
                  </button>

                  <button
                    onClick={() => handleEdit(seq.id)}
                    className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 hover:text-foreground"
                    title={tc("edit")}
                  >
                    <Pencil size={16} />
                  </button>

                  <button
                    onClick={() => handleDelete(seq.id)}
                    className="bg-transparent border-none text-red-500 cursor-pointer p-1 opacity-70 hover:opacity-100"
                    title={tc("delete")}
                  >
                    <Trash2 size={16} />
                  </button>

                  <button
                    onClick={() => handleEdit(seq.id)}
                    className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 hover:text-foreground"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom-2 fade-in duration-300",
          toast.includes("Error") || toast.includes("error") ? "bg-red-500" : "bg-emerald-500"
        )}>
          {toast}
        </div>
      )}

      <UpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        title={t("upgrade.title")}
        description={t("upgrade.description")}
      />
    </div>
  );
}
