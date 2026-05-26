"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Info, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { labelCls, inputCls } from "../_types";
import type { PersonaConfig } from "../_types";

interface ScheduleCardProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

interface TenantBusinessHours {
  is247: boolean;
  timezone: string;
  schedule: Record<string, { enabled: boolean; open: string; close: string }>;
  afterHoursMessage: string;
}

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function ScheduleCard({ config, onChange }: ScheduleCardProps) {
  const t = useTranslations("agent.schedule");
  const tb = useTranslations("settings.businessHoursPage");
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const [bizHours, setBizHours] = useState<TenantBusinessHours | null>(null);

  const aiOutsideHours = config.hours.aiOutsideHours ?? true;
  const overrideMessage = config.hours.afterHoursMessageOverride ?? "";

  useEffect(() => {
    async function loadBizHours() {
      const tenantId = activeTenantId || user?.tenantId;
      if (!tenantId) return;
      const result = await api.getTenant(tenantId);
      if (result.success && result.data) {
        const s = (result.data as any).settings || {};
        if (s.businessHours) setBizHours(s.businessHours);
      }
    }
    loadBizHours();
  }, [activeTenantId, user?.tenantId]);

  function toggleAiOutsideHours(on: boolean) {
    onChange({
      hours: { ...config.hours, aiOutsideHours: on },
    });
  }

  function updateOverrideMessage(msg: string) {
    onChange({
      hours: { ...config.hours, afterHoursMessageOverride: msg },
    });
  }

  return (
    <div className="space-y-5">
      {/* AI Outside Hours toggle */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {t("aiOutsideHours")}
          </span>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {t("aiOutsideHoursDesc")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={aiOutsideHours}
          onClick={() => toggleAiOutsideHours(!aiOutsideHours)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors cursor-pointer ${
            aiOutsideHours ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              aiOutsideHours ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Read-only business hours summary */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {t("businessHoursSummary")}
          </span>
          <a
            href="/admin/settings/business-hours"
            className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
          >
            {t("editBusinessHours")}
            <ExternalLink size={12} />
          </a>
        </div>

        {bizHours ? (
          bizHours.is247 ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
                24/7
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {tb("is247Desc")}
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {DAY_KEYS.map(key => {
                const day = bizHours.schedule?.[key];
                const enabled = day?.enabled ?? false;
                return (
                  <div key={key} className="flex items-center gap-3 text-xs">
                    <span className={`w-10 shrink-0 font-medium ${
                      enabled
                        ? "text-neutral-700 dark:text-neutral-300"
                        : "text-neutral-400 dark:text-neutral-500"
                    }`}>
                      {tb(`daysShort.${key}`)}
                    </span>
                    {enabled ? (
                      <span className="text-neutral-600 dark:text-neutral-400">
                        {day.open} – {day.close}
                      </span>
                    ) : (
                      <span className="text-neutral-400 dark:text-neutral-500 italic">
                        {tb("closed")}
                      </span>
                    )}
                  </div>
                );
              })}
              {bizHours.timezone && (
                <div className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                  {bizHours.timezone.replace(/_/g, " ")}
                </div>
              )}
            </div>
          )
        ) : (
          <p className="text-xs text-neutral-400 dark:text-neutral-500 italic">
            {t("noBusinessHours")}
          </p>
        )}
      </div>

      {/* After-hours message override (only when AI is OFF outside hours) */}
      {!aiOutsideHours && (
        <div>
          <label className={labelCls}>{t("overrideMessage")}</label>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
            {t("overridePlaceholder")}
          </p>
          <textarea
            value={overrideMessage}
            onChange={e => updateOverrideMessage(e.target.value)}
            placeholder={t("defaultMessageNote")}
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>
      )}

      {/* Info note */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/60">
        <Info size={14} className="text-neutral-400 shrink-0 mt-0.5" />
        <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
          {t("infoNote")}
        </p>
      </div>
    </div>
  );
}
