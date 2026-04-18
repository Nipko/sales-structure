"use client";

import { useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Appointment, Service, STATUS_CONFIG, DAY_KEYS, HOURS,
  fmt2, toLocalDate, addDays, getMondayOfWeek, formatTime, formatWeekRange,
} from "./shared";

interface ExternalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  provider: string;
  allDay?: boolean;
  htmlLink?: string;
}

interface CalendarGridProps {
  appointments: Appointment[];
  services: Service[];
  externalEvents: ExternalEvent[];
  weekStart: Date;
  dateLocale: string;
  onWeekChange: (newStart: Date) => void;
  onCreateAppointment: (date?: Date, hour?: number) => void;
  onEditAppointment: (appt: Appointment) => void;
}

export default function CalendarGrid({
  appointments, services, externalEvents, weekStart, dateLocale,
  onWeekChange, onCreateAppointment, onEditAppointment,
}: CalendarGridProps) {
  const t = useTranslations("appointments");
  const todayStr = toLocalDate(new Date());

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const getAppointmentsForDay = useCallback(
    (day: Date) => {
      const dayStr = toLocalDate(day);
      return appointments.filter((a) => a.startAt.startsWith(dayStr));
    },
    [appointments]
  );

  const getAppointmentPosition = (appt: Appointment) => {
    const start = new Date(appt.startAt);
    const end = new Date(appt.endAt);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const baseMinute = 7 * 60;
    const top = ((startMinutes - baseMinute) / 60) * 64;
    const height = Math.max(((endMinutes - startMinutes) / 60) * 64, 20);
    return { top, height };
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
      {/* Week navigation */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => onWeekChange(addDays(weekStart, -7))}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-600 dark:text-gray-300"
          title={t('prevWeek')}
        >
          <ChevronLeft size={20} />
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onWeekChange(getMondayOfWeek(new Date()))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 bg-transparent text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {t('today')}
          </button>
          <span className="font-semibold text-sm text-gray-900 dark:text-white">
            {formatWeekRange(weekDays[0], weekDays[6], dateLocale)}
          </span>
        </div>

        <button
          onClick={() => onWeekChange(addDays(weekStart, 7))}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-600 dark:text-gray-300"
          title={t('nextWeek')}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)]">
        <div className="border-b border-gray-200 dark:border-gray-800" />
        {weekDays.map((day, i) => {
          const isToday = toLocalDate(day) === todayStr;
          return (
            <div
              key={i}
              className={cn(
                "text-center py-3 border-b border-l border-gray-200 dark:border-gray-800",
                isToday && "bg-primary/5"
              )}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {t(`businessHoursPage.daysShort.${DAY_KEYS[i]}`)}
              </div>
              <div className={cn("text-lg font-bold mt-0.5", isToday ? "text-primary" : "text-gray-900 dark:text-white")}>
                {isToday ? (
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-sm">
                    {day.getDate()}
                  </span>
                ) : (
                  day.getDate()
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] max-h-[calc(14*64px)] overflow-y-auto">
        {HOURS.map((hour) => (
          <div key={`row-${hour}`} className="contents">
            <div className="h-16 flex items-start justify-end pr-2 pt-1 text-[11px] font-medium text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800/50">
              {fmt2(hour)}:00
            </div>
            {weekDays.map((day, di) => {
              const isToday = toLocalDate(day) === todayStr;
              return (
                <div
                  key={`${hour}-${di}`}
                  className={cn(
                    "h-16 border-b border-l border-gray-100 dark:border-gray-800/50 relative cursor-pointer hover:bg-primary/5 transition-colors",
                    isToday && "bg-primary/[0.02]"
                  )}
                  onClick={() => onCreateAppointment(day, hour)}
                >
                  {hour === 7 && (<>
                    {/* Internal appointments */}
                    {getAppointmentsForDay(day).map((appt) => {
                      const pos = getAppointmentPosition(appt);
                      const svc = services.find((s) => s.name === appt.serviceName);
                      const blockColor = svc?.color || STATUS_CONFIG[appt.status]?.color || "#6c5ce7";
                      return (
                        <div
                          key={appt.id}
                          className="absolute left-1 right-1 rounded-lg px-2 py-1 text-[10px] leading-tight overflow-hidden cursor-pointer z-10 border-l-[3px] shadow-sm"
                          style={{
                            top: `${pos.top}px`,
                            height: `${pos.height}px`,
                            background: `${blockColor}15`,
                            borderLeftColor: blockColor,
                            color: blockColor,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditAppointment(appt);
                          }}
                        >
                          <div className="font-semibold truncate">{appt.serviceName}</div>
                          {pos.height > 30 && (
                            <div className="truncate opacity-80">
                              {formatTime(appt.startAt)} - {formatTime(appt.endAt)}
                            </div>
                          )}
                          {pos.height > 48 && appt.contactName && (
                            <div className="truncate opacity-70">{appt.contactName}</div>
                          )}
                        </div>
                      );
                    })}
                    {/* External calendar events */}
                    {externalEvents
                      .filter(evt => {
                        if (evt.allDay) return false;
                        const evtDate = evt.start ? toLocalDate(new Date(evt.start)) : '';
                        return evtDate === toLocalDate(day);
                      })
                      .map(evt => {
                        const start = new Date(evt.start);
                        const end = new Date(evt.end);
                        const startMin = start.getHours() * 60 + start.getMinutes();
                        const endMin = end.getHours() * 60 + end.getMinutes();
                        const topOffset = startMin - 7 * 60;
                        const height = Math.max((endMin - startMin) / 60 * 64, 20);
                        const extColor = evt.provider === 'microsoft' ? '#0078d4' : '#4285f4';
                        return (
                          <div
                            key={`ext-${evt.id}`}
                            className="absolute left-1 right-1 rounded-lg px-2 py-1 text-[10px] leading-tight overflow-hidden z-[5] border-l-[3px] opacity-70"
                            style={{
                              top: `${(topOffset / 60) * 64}px`,
                              height: `${height}px`,
                              background: `${extColor}12`,
                              borderLeftColor: extColor,
                              color: extColor,
                              borderStyle: 'dashed',
                            }}
                            title={`${evt.title} (${evt.provider === 'microsoft' ? 'Outlook' : 'Google'})`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (evt.htmlLink) window.open(evt.htmlLink, '_blank');
                            }}
                          >
                            <div className="font-medium truncate flex items-center gap-1">
                              <span className="opacity-60">{evt.provider === 'microsoft' ? '\uD83D\uDCC5' : '\uD83D\uDCC6'}</span>
                              {evt.title}
                            </div>
                            {height > 30 && (
                              <div className="truncate opacity-80">
                                {start.getHours()}:{String(start.getMinutes()).padStart(2,'0')} - {end.getHours()}:{String(end.getMinutes()).padStart(2,'0')}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </>)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
