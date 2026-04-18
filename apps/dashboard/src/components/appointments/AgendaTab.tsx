"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Search, CalendarDays, CheckCircle2, CalendarCheck, Ban, Eye,
} from "lucide-react";
import { Appointment, Service, STATUS_CONFIG, formatDate, formatTime } from "./shared";

interface AgendaTabProps {
  appointments: Appointment[];
  services: Service[];
  dateLocale: string;
  onEditAppointment: (appt: Appointment) => void;
  onQuickAction: (apptId: string, action: "confirm" | "cancel" | "complete") => void;
}

export default function AgendaTab({
  appointments, services, dateLocale, onEditAppointment, onQuickAction,
}: AgendaTabProps) {
  const t = useTranslations("appointments");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const filteredAppointments = useMemo(() => {
    let list = [...appointments];
    if (filterStatus) list = list.filter((a) => a.status === filterStatus);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.serviceName.toLowerCase().includes(q) ||
          (a.contactName && a.contactName.toLowerCase().includes(q)) ||
          (a.assignedName && a.assignedName.toLowerCase().includes(q))
      );
    }
    if (filterStartDate) list = list.filter((a) => a.startAt >= filterStartDate);
    if (filterEndDate) list = list.filter((a) => a.startAt <= filterEndDate + "T23:59:59");
    return list.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [appointments, filterStatus, searchQuery, filterStartDate, filterEndDate]);

  return (
    <div className="space-y-4">
      {/* Search & filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('searchAppointments')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          />
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={() => setFilterStatus("")}
            className={cn(
              "px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
              !filterStatus
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
            )}
          >
            {t('allStatuses')}
          </button>
          {Object.entries(STATUS_CONFIG).map(([key, sc]) => (
            <button
              key={key}
              onClick={() => setFilterStatus(filterStatus === key ? "" : key)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                filterStatus === key
                  ? `${sc.twBg} ${sc.twText} border-current`
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              )}
            >
              {t(sc.i18nKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('from')}</label>
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('to')}</label>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        {(filterStartDate || filterEndDate || searchQuery) && (
          <button
            onClick={() => {
              setFilterStartDate("");
              setFilterEndDate("");
              setSearchQuery("");
              setFilterStatus("");
            }}
            className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none"
          >
            {t('clearFilters')}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        {filteredAppointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <CalendarDays size={28} className="text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('noAppointmentsToShow')}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {t('adjustFilters')}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">
                {[t("service"), t("client"), t("dateTime"), t("agent"), t("statusLabel"), t("actionsLabel")].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-5 py-3.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
              {filteredAppointments.map((appt) => {
                const sc = STATUS_CONFIG[appt.status];
                const svc = services.find((s) => s.name === appt.serviceName);
                return (
                  <tr key={appt.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: svc?.color || "#6c5ce7" }}
                        />
                        <span className="font-medium text-gray-900 dark:text-white">
                          {appt.serviceName}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      {appt.contactName || (
                        <span className="text-gray-400">{t('unassigned')}</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-gray-900 dark:text-white text-sm">
                        {formatDate(appt.startAt, dateLocale)}
                      </div>
                      <div className="text-gray-400 text-xs mt-0.5">
                        {formatTime(appt.startAt)} - {formatTime(appt.endAt)}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      {appt.assignedName || (
                        <span className="text-gray-400">{t('noAgent')}</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center text-[11px] px-2.5 py-1 rounded-full font-semibold",
                          sc.twBg,
                          sc.twText
                        )}
                      >
                        {t(sc.i18nKey)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onEditAppointment(appt)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                          title={t('viewDetails')}
                        >
                          <Eye size={15} />
                        </button>
                        {appt.status === "pending" && (
                          <button
                            onClick={() => onQuickAction(appt.id, "confirm")}
                            className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer border-none bg-transparent text-emerald-500"
                            title={t("actions.confirm")}
                          >
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                        {(appt.status === "pending" || appt.status === "confirmed") && (
                          <>
                            <button
                              onClick={() => onQuickAction(appt.id, "complete")}
                              className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer border-none bg-transparent text-blue-500"
                              title={t("actions.complete")}
                            >
                              <CalendarCheck size={15} />
                            </button>
                            <button
                              onClick={() => onQuickAction(appt.id, "cancel")}
                              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer border-none bg-transparent text-red-500"
                              title={t("actions.cancel")}
                            >
                              <Ban size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
