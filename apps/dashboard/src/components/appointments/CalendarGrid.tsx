"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, CalendarDays, Clock, Repeat } from "lucide-react";
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

type ViewMode = "week" | "day";

interface CalendarGridProps {
  appointments: Appointment[];
  services: Service[];
  externalEvents: ExternalEvent[];
  weekStart: Date;
  dateLocale: string;
  onWeekChange: (newStart: Date) => void;
  onCreateAppointment: (date?: Date, hour?: number) => void;
  onEditAppointment: (appt: Appointment) => void;
  onReschedule?: (apptId: string, newDate: string, newStartTime: string, newEndTime: string) => void;
}

const HOUR_HEIGHT = 52; // px per hour row — fits 14 hours (~728px) without scroll on most screens

export default function CalendarGrid({
  appointments, services, externalEvents, weekStart, dateLocale,
  onWeekChange, onCreateAppointment, onEditAppointment, onReschedule,
}: CalendarGridProps) {
  const t = useTranslations("appointments");
  const todayStr = toLocalDate(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [dragApptId, setDragApptId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current hour on mount
  useEffect(() => {
    if (gridRef.current) {
      const now = new Date();
      const scrollTo = Math.max((now.getHours() - 8) * HOUR_HEIGHT, 0);
      gridRef.current.scrollTop = scrollTo;
    }
  }, [viewMode]);

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

  const getExternalEventsForDay = useCallback(
    (day: Date) => {
      const dayStr = toLocalDate(day);
      return externalEvents.filter(evt => {
        if (evt.allDay) return false;
        return evt.start ? toLocalDate(new Date(evt.start)) === dayStr : false;
      });
    },
    [externalEvents]
  );

  const getAppointmentPosition = (appt: Appointment) => {
    const start = new Date(appt.startAt);
    const end = new Date(appt.endAt);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const baseMinute = 7 * 60;
    const top = ((startMinutes - baseMinute) / 60) * HOUR_HEIGHT;
    const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 24);
    return { top, height };
  };

  // Current time indicator position
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMinutes - 7 * 60) / 60) * HOUR_HEIGHT;
  const showNowLine = nowMinutes >= 7 * 60 && nowMinutes <= 21 * 60;

  // Navigation helpers
  const handlePrev = () => {
    if (viewMode === "week") onWeekChange(addDays(weekStart, -7));
    else setSelectedDay(addDays(selectedDay, -1));
  };
  const handleNext = () => {
    if (viewMode === "week") onWeekChange(addDays(weekStart, 7));
    else setSelectedDay(addDays(selectedDay, 1));
  };
  const handleToday = () => {
    if (viewMode === "week") onWeekChange(getMondayOfWeek(new Date()));
    else setSelectedDay(new Date());
  };

  // Day header click → switch to day view
  const handleDayHeaderClick = (day: Date) => {
    setSelectedDay(day);
    setViewMode("day");
  };

  // Format navigation title
  const navTitle = viewMode === "week"
    ? formatWeekRange(weekDays[0], weekDays[6], dateLocale)
    : selectedDay.toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Columns to render
  const columns = viewMode === "week" ? weekDays : [selectedDay];
  const gridCols = viewMode === "week" ? "grid-cols-[56px_repeat(7,1fr)]" : "grid-cols-[56px_1fr]";

  // Render an appointment block
  const renderAppointment = (appt: Appointment, isDayView: boolean) => {
    const pos = getAppointmentPosition(appt);
    const svc = services.find((s) => s.name === appt.serviceName);
    const blockColor = svc?.color || STATUS_CONFIG[appt.status]?.color || "#6c5ce7";
    return (
      <div
        key={appt.id}
        draggable={!!onReschedule}
        onDragStart={(e) => {
          setDragApptId(appt.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', appt.id);
        }}
        onDragEnd={() => setDragApptId(null)}
        className={cn(
          "absolute rounded-lg px-2.5 py-1.5 overflow-hidden cursor-pointer z-10 border-l-[3px] shadow-sm hover:shadow-md transition-shadow",
          isDayView ? "left-2 right-2 text-xs" : "left-1 right-1 text-[10px]",
          dragApptId === appt.id && "opacity-50",
          onReschedule && "cursor-grab active:cursor-grabbing"
        )}
        style={{
          top: `${pos.top}px`,
          height: `${pos.height}px`,
          background: `${blockColor}15`,
          borderLeftColor: blockColor,
          color: blockColor,
        }}
        onClick={(e) => { e.stopPropagation(); onEditAppointment(appt); }}
      >
        <div className="font-semibold truncate flex items-center gap-1">
          {appt.recurringGroupId && <Repeat size={isDayView ? 11 : 9} className="shrink-0 opacity-70" />}
          {appt.serviceName}
        </div>
        {pos.height > 24 && (
          <div className="truncate opacity-80">
            {formatTime(appt.startAt)} - {formatTime(appt.endAt)}
          </div>
        )}
        {pos.height > 38 && appt.contactName && (
          <div className="truncate opacity-70">{appt.contactName}</div>
        )}
        {isDayView && pos.height > 50 && appt.assignedName && (
          <div className="truncate opacity-60 mt-0.5">{appt.assignedName}</div>
        )}
      </div>
    );
  };

  // Render an external event block
  const renderExternalEvent = (evt: ExternalEvent, isDayView: boolean) => {
    const start = new Date(evt.start);
    const end = new Date(evt.end);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const topOffset = startMin - 7 * 60;
    const height = Math.max((endMin - startMin) / 60 * HOUR_HEIGHT, 20);
    const extColor = evt.provider === 'microsoft' ? '#0078d4' : '#4285f4';
    return (
      <div
        key={`ext-${evt.id}`}
        className={cn(
          "absolute rounded-lg px-2 py-1 overflow-hidden z-[5] border-l-[3px] opacity-70",
          isDayView ? "left-2 right-2 text-xs" : "left-1 right-1 text-[10px]"
        )}
        style={{
          top: `${(topOffset / 60) * HOUR_HEIGHT}px`,
          height: `${height}px`,
          background: `${extColor}12`,
          borderLeftColor: extColor,
          color: extColor,
          borderStyle: 'dashed',
        }}
        title={`${evt.title} (${evt.provider === 'microsoft' ? 'Outlook' : 'Google'})`}
        onClick={(e) => { e.stopPropagation(); if (evt.htmlLink) window.open(evt.htmlLink, '_blank'); }}
      >
        <div className="font-medium truncate flex items-center gap-1">
          <span className="opacity-60">{evt.provider === 'microsoft' ? '\uD83D\uDCC5' : '\uD83D\uDCC6'}</span>
          {evt.title}
        </div>
        {height > 30 && (
          <div className="truncate opacity-80">
            {fmt2(start.getHours())}:{fmt2(start.getMinutes())} - {fmt2(end.getHours())}:{fmt2(end.getMinutes())}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
      {/* Navigation bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <button onClick={handlePrev}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-600 dark:text-gray-300"
            title={viewMode === "week" ? t('prevWeek') : t('prevDay')}>
            <ChevronLeft size={20} />
          </button>
          <button onClick={handleToday}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 bg-transparent text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            {t('today')}
          </button>
          <button onClick={handleNext}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-600 dark:text-gray-300"
            title={viewMode === "week" ? t('nextWeek') : t('nextDay')}>
            <ChevronRight size={20} />
          </button>
        </div>

        <span className="font-semibold text-sm text-gray-900 dark:text-white capitalize">
          {navTitle}
        </span>

        {/* View toggle */}
        <div className="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <button onClick={() => setViewMode("week")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer border-none",
              viewMode === "week"
                ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                : "bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700")}>
            <CalendarDays size={13} /> {t('weekView')}
          </button>
          <button onClick={() => { setViewMode("day"); setSelectedDay(new Date()); }}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer border-none",
              viewMode === "day"
                ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                : "bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700")}>
            <Clock size={13} /> {t('dayView')}
          </button>
        </div>
      </div>

      {/* Day headers (week view) */}
      {viewMode === "week" && (
        <div className={`grid ${gridCols}`}>
          <div className="border-b border-gray-200 dark:border-gray-800" />
          {weekDays.map((day, i) => {
            const isToday = toLocalDate(day) === todayStr;
            return (
              <div
                key={i}
                onClick={() => handleDayHeaderClick(day)}
                className={cn(
                  "text-center py-3 border-b border-l border-gray-200 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors",
                  isToday && "bg-primary/5"
                )}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {t(`daysShort.${DAY_KEYS[i]}`)}
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
      )}

      {/* Day header (day view) */}
      {viewMode === "day" && (
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold",
            toLocalDate(selectedDay) === todayStr
              ? "bg-primary text-white"
              : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white"
          )}>
            {selectedDay.getDate()}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
              {selectedDay.toLocaleDateString(dateLocale, { weekday: "long" })}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {getAppointmentsForDay(selectedDay).length} {t('total').toLowerCase()}
            </div>
          </div>
        </div>
      )}

      {/* Time grid — fills available viewport, scrolls only when needed */}
      <div ref={gridRef} className={`grid ${gridCols} overflow-y-auto`} style={{ maxHeight: 'calc(100vh - 340px)' }}>
        {HOURS.map((hour) => (
          <div key={`row-${hour}`} className="contents">
            {/* Hour label */}
            <div className={`border-b border-gray-100 dark:border-gray-800/50 flex items-start justify-end pr-2 pt-1 text-[11px] font-medium text-gray-400 dark:text-gray-500`}
              style={{ height: `${HOUR_HEIGHT}px` }}>
              {fmt2(hour)}:00
            </div>

            {/* Day columns */}
            {columns.map((day, di) => {
              const isToday = toLocalDate(day) === todayStr;
              const isDayView = viewMode === "day";
              return (
                <div
                  key={`${hour}-${di}`}
                  className={cn(
                    "border-b border-l border-gray-100 dark:border-gray-800/50 relative cursor-pointer hover:bg-primary/5 transition-colors",
                    isToday && "bg-primary/[0.02]"
                  )}
                  style={{ height: `${HOUR_HEIGHT}px` }}
                  onClick={() => onCreateAppointment(day, hour)}
                  onDragOver={(e) => { if (dragApptId) { e.preventDefault(); e.currentTarget.classList.add('bg-primary/10'); } }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove('bg-primary/10'); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-primary/10');
                    const apptId = e.dataTransfer.getData('text/plain');
                    if (!apptId || !onReschedule) return;
                    const appt = appointments.find(a => a.id === apptId);
                    if (!appt) return;
                    const start = new Date(appt.startAt);
                    const end = new Date(appt.endAt);
                    const durationMs = end.getTime() - start.getTime();
                    const newDate = toLocalDate(day);
                    const newStart = `${fmt2(hour)}:00`;
                    const newEndMs = new Date(`${newDate}T${newStart}:00`).getTime() + durationMs;
                    const newEndD = new Date(newEndMs);
                    const newEnd = `${fmt2(newEndD.getHours())}:${fmt2(newEndD.getMinutes())}`;
                    onReschedule(apptId, newDate, newStart, newEnd);
                    setDragApptId(null);
                  }}
                >
                  {/* Render appointments + external events only in first hour row (positioned absolutely) */}
                  {hour === 7 && (<>
                    {getAppointmentsForDay(day).map((appt) => renderAppointment(appt, isDayView))}
                    {getExternalEventsForDay(day).map((evt) => renderExternalEvent(evt, isDayView))}

                    {/* Current time indicator */}
                    {isToday && showNowLine && (
                      <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${nowTop}px` }}>
                        <div className="flex items-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1" />
                          <div className="flex-1 h-[2px] bg-red-500" />
                        </div>
                      </div>
                    )}
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
