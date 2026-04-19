"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Calendar, Wrench, AlertTriangle, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PersonaConfig } from "../_types";

interface CapabilitiesSectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
  apptReadiness: { services: number; slots: number; loaded: boolean };
}

export function CapabilitiesSection({ config, onChange, apptReadiness }: CapabilitiesSectionProps) {
  const tools = config.tools || { appointments: { enabled: false, canBook: true, canCancel: true } };
  const apt = tools.appointments || { enabled: false, canBook: true, canCancel: true };

  const canEnableAppointments = apptReadiness.loaded && apptReadiness.services > 0 && apptReadiness.slots > 0;
  const missingItems: string[] = [];
  if (apptReadiness.loaded && apptReadiness.services === 0) missingItems.push("services");
  if (apptReadiness.loaded && apptReadiness.slots === 0) missingItems.push("availability schedule");
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
        Ready
      </Badge>
    );
  } else if (apt.enabled && !canEnableAppointments) {
    statusBadge = (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 text-[11px]">
        Setup needed
      </Badge>
    );
  } else {
    statusBadge = (
      <Badge variant="secondary" className="text-[11px]">
        Disabled
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
                  Appointment Scheduling
                </h4>
                {statusBadge}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Check availability, schedule and cancel appointments
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { if (!toggleBlocked) updateTools({ enabled: !apt.enabled }); }}
            disabled={toggleBlocked}
            title={toggleBlocked ? `Configure ${missingItems.join(" and ")} before activating` : undefined}
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
              Services ({apptReadiness.services})
            </span>
            <span className={cn(
              "flex items-center gap-1",
              apptReadiness.slots > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400"
            )}>
              {apptReadiness.slots > 0 ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
              Availability ({apptReadiness.slots})
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
                  ? `This tool is active but missing ${missingItems.join(" and ")}. The bot will respond with "no availability" until you complete the configuration.`
                  : `First configure ${missingItems.join(" and ")} in Appointments.`}
              </p>
              <Link href="/admin/appointments" className="inline-block mt-1.5 text-xs font-semibold text-indigo-500 hover:underline">
                Go to Appointments →
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
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Create appointments</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Schedule new appointments with customer confirmation</p>
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
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Cancel appointments</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Cancel appointments for the same customer who requests it</p>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Future tools placeholder */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 opacity-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <Wrench size={18} className="text-neutral-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-neutral-400">More tools coming soon</h4>
            <p className="text-xs text-neutral-400">Catalog, CRM, payments and more</p>
          </div>
        </div>
      </div>
    </div>
  );
}
