"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Calendar, Wrench, AlertTriangle, CheckCircle, ShoppingBag, HelpCircle, Scale, BookOpen, Sliders, Tag, Package, UserCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PersonaConfig } from "../_types";

interface CapabilitiesSectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
  apptReadiness: { services: number; slots: number; loaded: boolean };
}

export function CapabilitiesSection({ config, onChange, apptReadiness }: CapabilitiesSectionProps) {
  const t = useTranslations("agent.capabilities");
  const tools = config.tools || { appointments: { enabled: false, canBook: true, canCancel: true } };
  const apt = tools.appointments || { enabled: false, canBook: true, canCancel: true };

  const canEnableAppointments = apptReadiness.loaded && apptReadiness.services > 0 && apptReadiness.slots > 0;
  const missingItems: string[] = [];
  if (apptReadiness.loaded && apptReadiness.services === 0) missingItems.push(t("servicesLabel"));
  if (apptReadiness.loaded && apptReadiness.slots === 0) missingItems.push(t("availabilityScheduleLabel"));
  const toggleBlocked = !canEnableAppointments && !apt.enabled;

  function updateTools(updates: Partial<typeof apt>) {
    onChange({
      tools: { ...tools, appointments: { ...apt, ...updates } },
    });
  }

  // Status badge
  let statusBadge: React.ReactNode;
  if (apt.enabled && canEnableAppointments) {
    statusBadge = (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 text-[11px]">
        {t("ready")}
      </Badge>
    );
  } else if (apt.enabled && !canEnableAppointments) {
    statusBadge = (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 text-[11px]">
        {t("setupNeeded")}
      </Badge>
    );
  } else {
    statusBadge = (
      <Badge variant="secondary" className="text-[11px]">
        {t("disabled")}
      </Badge>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Appointments tool */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Calendar size={18} className="text-indigo-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {t("appointmentScheduling")}
                </h4>
                {statusBadge}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {t("appointmentDesc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { if (!toggleBlocked) updateTools({ enabled: !apt.enabled }); }}
            disabled={toggleBlocked}
            title={toggleBlocked ? t("configureBeforeActivating", { items: missingItems.join(t("andSeparator")) }) : undefined}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors shrink-0",
              apt.enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
              toggleBlocked && "opacity-40 cursor-not-allowed"
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
              apt.enabled ? "translate-x-[22px]" : "translate-x-0.5"
            )} />
          </button>
        </div>

        {/* Prerequisites checklist */}
        {apptReadiness.loaded && (
          <div className="flex gap-3 mt-3 text-xs">
            <span className={cn(
              "flex items-center gap-1",
              apptReadiness.services > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400"
            )}>
              {apptReadiness.services > 0 ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
              {t("services")} ({apptReadiness.services})
            </span>
            <span className={cn(
              "flex items-center gap-1",
              apptReadiness.slots > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400"
            )}>
              {apptReadiness.slots > 0 ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
              {t("availability")} ({apptReadiness.slots})
            </span>
          </div>
        )}

        {/* Warning when missing prerequisites */}
        {apptReadiness.loaded && !canEnableAppointments && (
          <div className={cn(
            "flex items-start gap-2 p-3 rounded-lg border mt-3",
            apt.enabled
              ? "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30"
              : "bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700"
          )}>
            <AlertTriangle size={14} className={cn("shrink-0 mt-0.5", apt.enabled ? "text-red-500" : "text-neutral-400")} />
            <div className="flex-1">
              <p className={cn("text-xs font-medium", apt.enabled ? "text-red-700 dark:text-red-300" : "text-neutral-600 dark:text-neutral-300")}>
                {apt.enabled
                  ? t("activeButMissing", { items: missingItems.join(t("andSeparator")) })
                  : t("configureBefore", { items: missingItems.join(t("andSeparator")) })}
              </p>
              <Link href="/admin/appointments" className="inline-block mt-1.5 text-xs font-semibold text-indigo-500 hover:underline">
                {t("goToAppointments")} →
              </Link>
            </div>
          </div>
        )}

        {/* Sub-options when enabled */}
        {apt.enabled && (
          <div className="space-y-2.5 border-t border-neutral-100 dark:border-neutral-800 pt-3 mt-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={apt.canBook}
                onChange={e => updateTools({ canBook: e.target.checked })}
                className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("createAppointments")}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("createAppointmentsDesc")}</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={apt.canCancel}
                onChange={e => updateTools({ canCancel: e.target.checked })}
                className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("cancelAppointments")}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("cancelAppointmentsDesc")}</p>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Catalog tools */}
      <ToolToggleCard
        icon={ShoppingBag}
        title={t("catalogTitle")}
        description={t("catalogDesc")}
        enabled={tools.catalog?.enabled === true}
        onToggle={(v) => onChange({ tools: { ...tools, catalog: { ...(tools.catalog ?? { enabled: false }), enabled: v } } })}
      />

      {/* FAQs */}
      <ToolToggleCard
        icon={HelpCircle}
        title={t("faqsTitle")}
        description={t("faqsDesc")}
        enabled={tools.faqs?.enabled === true}
        onToggle={(v) => onChange({ tools: { ...tools, faqs: { enabled: v } } })}
      />

      {/* Policies */}
      <ToolToggleCard
        icon={Scale}
        title={t("policiesTitle")}
        description={t("policiesDesc")}
        enabled={tools.policies?.enabled === true}
        onToggle={(v) => onChange({ tools: { ...tools, policies: { enabled: v } } })}
      />

      {/* Active offers / promotions */}
      <ToolToggleCard
        icon={Tag}
        title={t("offersTitle")}
        description={t("offersDesc")}
        enabled={tools.offers?.enabled === true}
        onToggle={(v) => onChange({ tools: { ...tools, offers: { enabled: v } } })}
      />

      {/* Customer order history */}
      <ToolToggleCard
        icon={Package}
        title={t("ordersTitle")}
        description={t("ordersDesc")}
        enabled={tools.orders?.enabled === true}
        onToggle={(v) => onChange({ tools: { ...tools, orders: { enabled: v } } })}
      />

      {/* CRM context (lead score, tags, stage) */}
      <ToolToggleCard
        icon={UserCircle}
        title={t("crmTitle")}
        description={t("crmDesc")}
        enabled={tools.crm?.enabled === true}
        onToggle={(v) => onChange({ tools: { ...tools, crm: { enabled: v } } })}
      />

      {/* Knowledge Base (RAG) */}
      <KnowledgeSection config={config} onChange={onChange} t={t} />
    </div>
  );
}

function ToolToggleCard({ icon: Icon, title, description, enabled, onToggle }: {
  icon: any;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Icon size={18} className="text-indigo-500" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors shrink-0",
            enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
          )}
        >
          <div className={cn(
            "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
            enabled ? "translate-x-[22px]" : "translate-x-0.5",
          )} />
        </button>
      </div>
    </div>
  );
}

function KnowledgeSection({ config, onChange, t }: { config: PersonaConfig; onChange: (updates: Partial<PersonaConfig>) => void; t: any }) {
  const rag = config.rag ?? { enabled: false, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 };
  const tools: NonNullable<PersonaConfig["tools"]> = config.tools ?? { appointments: { enabled: false, canBook: true, canCancel: true } };
  const kbToolEnabled = tools.knowledge?.enabled === true;

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <BookOpen size={18} className="text-indigo-500" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("knowledgeTitle")}</h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("knowledgeDesc")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange({ rag: { ...rag, enabled: !rag.enabled } })}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors shrink-0",
            rag.enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
          )}
        >
          <div className={cn(
            "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
            rag.enabled ? "translate-x-[22px]" : "translate-x-0.5",
          )} />
        </button>
      </div>

      {rag.enabled && (
        <div className="space-y-3 border-t border-neutral-100 dark:border-neutral-800 pt-3">
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
            <Sliders size={12} />
            {t("ragTuning")}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-neutral-600 dark:text-neutral-400">{t("topK")}</label>
              <span className="text-xs font-mono text-neutral-900 dark:text-neutral-100">{rag.topK ?? 5}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={rag.topK ?? 5}
              onChange={e => onChange({ rag: { ...rag, topK: parseInt(e.target.value) } })}
              className="w-full accent-indigo-500"
            />
            <p className="text-[10px] text-neutral-500 mt-1">{t("topKHint")}</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-neutral-600 dark:text-neutral-400">{t("similarityThreshold")}</label>
              <span className="text-xs font-mono text-neutral-900 dark:text-neutral-100">{(rag.similarityThreshold ?? 0.75).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={rag.similarityThreshold ?? 0.75}
              onChange={e => onChange({ rag: { ...rag, similarityThreshold: parseFloat(e.target.value) } })}
              className="w-full accent-indigo-500"
            />
            <p className="text-[10px] text-neutral-500 mt-1">{t("similarityHint")}</p>
          </div>

          <label className="flex items-center gap-3 cursor-pointer pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <input
              type="checkbox"
              checked={kbToolEnabled}
              onChange={e => onChange({ tools: { ...tools, knowledge: { enabled: e.target.checked } } })}
              className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 accent-indigo-500"
            />
            <div>
              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("kbTool")}</span>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("kbToolDesc")}</p>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
