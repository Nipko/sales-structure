"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { inputCls, selectCls, labelCls } from "../_types";
import type { PersonaConfig } from "../_types";

interface ScheduleCardProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
}

const DAY_KEYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];

const TIMEZONES = [
  "America/Bogota",
  "America/Mexico_City",
  "America/Lima",
  "America/Santiago",
  "America/Buenos_Aires",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/Madrid",
  "Europe/London",
  "UTC",
];

const DAY_KEYS_TO_I18N: Record<string, string> = {
  lun: "monday",
  mar: "tuesday",
  mie: "wednesday",
  jue: "thursday",
  vie: "friday",
  sab: "saturday",
  dom: "sunday",
};

export function ScheduleCard({ config, onChange }: ScheduleCardProps) {
  const t = useTranslations("agent.schedule");
  const schedule = config.hours.schedule;

  const is247 = Object.values(schedule).every(
    v => v !== null && v.start === "00:00" && v.end === "23:59"
  );

  function toggle247(on: boolean) {
    if (on) {
      const allDay: Record<string, { start: string; end: string }> = {};
      for (const key of DAY_KEYS) {
        allDay[key] = { start: "00:00", end: "23:59" };
      }
      onChange({ hours: { ...config.hours, schedule: allDay } });
    } else {
      // Reset to default business hours
      const businessHours: Record<string, { start: string; end: string } | null> = {};
      for (const key of DAY_KEYS) {
        if (key === "dom") {
          businessHours[key] = null;
        } else if (key === "sab") {
          businessHours[key] = { start: "08:00", end: "14:00" };
        } else {
          businessHours[key] = { start: "08:00", end: "18:00" };
        }
      }
      onChange({ hours: { ...config.hours, schedule: businessHours } });
    }
  }

  function toggleDay(dayKey: string) {
    const current = schedule[dayKey];
    const newSchedule = { ...schedule };
    if (current === null) {
      newSchedule[dayKey] = { start: "08:00", end: "18:00" };
    } else {
      newSchedule[dayKey] = null;
    }
    onChange({ hours: { ...config.hours, schedule: newSchedule } });
  }

  function updateDayTime(dayKey: string, field: "start" | "end", value: string) {
    const current = schedule[dayKey];
    if (!current) return;
    const newSchedule = { ...schedule };
    newSchedule[dayKey] = { ...current, [field]: value };
    onChange({ hours: { ...config.hours, schedule: newSchedule } });
  }

  function updateTimezone(tz: string) {
    onChange({ hours: { ...config.hours, timezone: tz } });
  }

  function updateAfterHoursMessage(msg: string) {
    onChange({ hours: { ...config.hours, afterHoursMessage: msg } });
  }

  return (
    <div className="mt-3 space-y-5">
      {/* 24/7 toggle */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {t("available247")}
          </span>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {t("available247Desc")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={is247}
          onClick={() => toggle247(!is247)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors cursor-pointer ${
            is247 ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              is247 ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {!is247 && (
        <>
          {/* Per-day schedule */}
          <div className="space-y-2">
            {DAY_KEYS.map(key => {
              const daySchedule = schedule[key];
              const isActive = daySchedule !== null;
              const label = t(DAY_KEYS_TO_I18N[key] || "monday");

              return (
                <div
                  key={key}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50"
                >
                  {/* Day toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    onClick={() => toggleDay(key)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                      isActive ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                        isActive ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>

                  {/* Day label */}
                  <span className={`text-sm w-24 shrink-0 ${
                    isActive
                      ? "text-neutral-900 dark:text-neutral-100 font-medium"
                      : "text-neutral-400 dark:text-neutral-500"
                  }`}>
                    {label}
                  </span>

                  {/* Time inputs or "Closed" */}
                  {isActive ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="time"
                        value={daySchedule.start}
                        onChange={e => updateDayTime(key, "start", e.target.value)}
                        className={`${inputCls} !w-auto !py-1.5 !px-2.5 text-xs`}
                      />
                      <span className="text-xs text-neutral-400">{t("to")}</span>
                      <input
                        type="time"
                        value={daySchedule.end}
                        onChange={e => updateDayTime(key, "end", e.target.value)}
                        className={`${inputCls} !w-auto !py-1.5 !px-2.5 text-xs`}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500 italic">
                      {t("closed")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* After-hours message */}
          <div>
            <label className={labelCls}>{t("afterHoursMessage")}</label>
            <textarea
              value={config.hours.afterHoursMessage}
              onChange={e => updateAfterHoursMessage(e.target.value)}
              placeholder={t("afterHoursPlaceholder")}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>
        </>
      )}

      {/* Timezone */}
      <div>
        <label className={labelCls}>{t("timezone")}</label>
        <select
          value={config.hours.timezone}
          onChange={e => updateTimezone(e.target.value)}
          className={selectCls}
        >
          {TIMEZONES.map(tz => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

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
