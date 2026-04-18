"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Clock, Calendar, Link2, Ban, Bell, Users, Settings2,
    Plus, Trash2, CheckCircle2, AlertTriangle, ChevronDown,
} from "lucide-react";

interface AvailabilitySlot {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    active: boolean;
}

interface BlockedDate {
    id: string;
    blockedDate: string;
    reason?: string;
}

interface CalendarIntegration {
    id: string;
    provider: "google" | "microsoft";
    email: string;
    active: boolean;
}

interface ConfigTabProps {
    activeTenantId: string;
    availabilitySlots: AvailabilitySlot[];
    setAvailabilitySlots: (slots: AvailabilitySlot[]) => void;
    hasSavedAvailability?: boolean;
    blockedDates: BlockedDate[];
    calendarIntegrations: CalendarIntegration[];
    externalEventsCount: number;
    onConnectCalendar: (provider: "google" | "microsoft") => void;
    onDisconnectCalendar: (integrationId: string) => void;
    onSaveAvailability: () => void;
    onAddBlockedDate: (date: string, reason: string) => void;
    onDeleteBlockedDate: (id: string) => void;
    onRefresh: () => void;
    showToast: (msg: string) => void;
}

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

// ── Card wrapper ──
function ConfigCard({ icon: Icon, iconColor, title, description, children, badge }: {
    icon: any; iconColor: string; title: string; description: string; children: React.ReactNode; badge?: string;
}) {
    return (
        <div className="rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-sm">
            <div className="px-6 py-5 border-b border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-3">
                    <div className={cn("p-2.5 rounded-xl", iconColor)}>
                        <Icon size={18} className="text-current" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                            {badge && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
                                    {badge}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                </div>
            </div>
            <div className="p-6">{children}</div>
        </div>
    );
}

// ── Toggle ──
function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label?: string }) {
    return (
        <button onClick={() => onChange(!enabled)} className="flex items-center gap-3">
            <div className={cn("w-11 h-6 rounded-full relative transition-colors", enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-white/20")}>
                <div className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform", enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
            </div>
            {label && <span className="text-sm text-foreground">{label}</span>}
        </button>
    );
}

export default function ConfigTab({
    activeTenantId, availabilitySlots, setAvailabilitySlots, hasSavedAvailability = true,
    blockedDates, calendarIntegrations, externalEventsCount,
    onConnectCalendar, onDisconnectCalendar, onSaveAvailability,
    onAddBlockedDate, onDeleteBlockedDate, onRefresh, showToast,
}: ConfigTabProps) {
    const t = useTranslations("appointments");
    const { user } = useAuth();
    const [newBlockedDate, setNewBlockedDate] = useState("");
    const [newBlockedReason, setNewBlockedReason] = useState("");
    const [reminder24h, setReminder24h] = useState(true);
    const [reminder1h, setReminder1h] = useState(true);
    const [noShowFollowUp, setNoShowFollowUp] = useState(true);

    const is247 = availabilitySlots.every(s => s.active && s.startTime === "00:00" && s.endTime === "23:59");

    const toggle247 = (enabled: boolean) => {
        if (enabled) {
            setAvailabilitySlots(availabilitySlots.map(s => ({ ...s, active: true, startTime: "00:00", endTime: "23:59" })));
        } else {
            setAvailabilitySlots(availabilitySlots.map((s, i) => ({
                ...s,
                active: i < 5,
                startTime: "09:00",
                endTime: "18:00",
            })));
        }
    };

    const handleAddBlocked = () => {
        if (!newBlockedDate) return;
        onAddBlockedDate(newBlockedDate, newBlockedReason);
        setNewBlockedDate("");
        setNewBlockedReason("");
    };

    const inputCls = "w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

    return (
        <div className="space-y-6">

            {!hasSavedAvailability && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
                    <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-red-700 dark:text-red-300">Horarios no guardados</p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                            Todavía no configuraste los horarios de atención. Los valores que ves son solo sugerencias, no están en la base de datos. Si tu agente IA tiene la herramienta de agendamiento activada, responderá <em>&quot;no hay disponibilidad&quot;</em> a todos los clientes hasta que guardes esta configuración.
                        </p>
                    </div>
                </div>
            )}

            {/* ── 1. Connected Calendars ── */}
            <ConfigCard icon={Link2} iconColor="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                title={t("configSection.calendars")} description={t("configSection.calendarsDesc")}>
                {calendarIntegrations.length > 0 ? (
                    <div className="space-y-3">
                        {calendarIntegrations.map((cal: any) => (
                            <div key={cal.id} className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                                <div className="flex items-center gap-3">
                                    <CheckCircle2 size={18} className="text-emerald-500" />
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            {cal.provider === 'microsoft' ? '📅 Outlook' : '📅 Google'} Calendar
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {cal.account_email || cal.accountEmail || cal.email || t("configSection.connected")}
                                            {externalEventsCount > 0 && ` · ${externalEventsCount} ${t("configSection.eventsSynced")}`}
                                        </p>
                                    </div>
                                </div>
                                <button onClick={() => onDisconnectCalendar(cal.id)}
                                    className="text-xs text-red-500 hover:text-red-600 font-medium">
                                    {t("configSection.disconnect")}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-4">
                        <p className="text-sm text-muted-foreground mb-4">{t("configSection.noCalendar")}</p>
                    </div>
                )}
                <div className="flex gap-3 mt-4">
                    <button onClick={() => onConnectCalendar("google")}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-sm font-medium hover:shadow-md transition-shadow cursor-pointer">
                        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                        {t("configSection.connectGoogle")}
                    </button>
                    <button onClick={() => onConnectCalendar("microsoft")}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-sm font-medium hover:shadow-md transition-shadow cursor-pointer">
                        <svg width="16" height="16" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
                        {t("configSection.connectOutlook")}
                    </button>
                </div>
            </ConfigCard>

            {/* ── 2. Working Hours ── */}
            <ConfigCard icon={Clock} iconColor="bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                title={t("configSection.schedule")} description={t("configSection.scheduleDesc")}>

                {/* 24/7 Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 mb-5">
                    <div>
                        <p className="text-sm font-semibold text-foreground">{t("configSection.available247")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t("configSection.available247Desc")}</p>
                    </div>
                    <Toggle enabled={is247} onChange={toggle247} />
                </div>

                {!is247 && (
                    <div className="space-y-2.5">
                        {availabilitySlots.map((slot, i) => (
                            <div key={slot.dayOfWeek} className={cn(
                                "flex items-center gap-4 p-3 rounded-xl border transition-all",
                                slot.active ? "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900" : "border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/30"
                            )}>
                                <Toggle enabled={slot.active} onChange={(v) => {
                                    const updated = [...availabilitySlots];
                                    updated[i] = { ...updated[i], active: v };
                                    setAvailabilitySlots(updated);
                                }} />
                                <span className={cn("w-24 text-sm font-medium", slot.active ? "text-foreground" : "text-muted-foreground")}>
                                    {t(`days.${DAY_KEYS[i]}`)}
                                </span>
                                {slot.active ? (
                                    <div className="flex items-center gap-2">
                                        <input type="time" value={slot.startTime} onChange={e => {
                                            const updated = [...availabilitySlots];
                                            updated[i] = { ...updated[i], startTime: e.target.value };
                                            setAvailabilitySlots(updated);
                                        }} className={cn(inputCls, "w-32")} />
                                        <span className="text-muted-foreground text-xs">—</span>
                                        <input type="time" value={slot.endTime} onChange={e => {
                                            const updated = [...availabilitySlots];
                                            updated[i] = { ...updated[i], endTime: e.target.value };
                                            setAvailabilitySlots(updated);
                                        }} className={cn(inputCls, "w-32")} />
                                    </div>
                                ) : (
                                    <span className="text-xs text-muted-foreground italic">{t("configSection.closed")}</span>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <button onClick={onSaveAvailability}
                    className="mt-4 px-5 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors cursor-pointer border-none">
                    {t("actions.confirm")}
                </button>
            </ConfigCard>

            {/* ── 3. Reminders ── */}
            <ConfigCard icon={Bell} iconColor="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
                title={t("configSection.reminders")} description={t("configSection.remindersDesc")}>
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-700">
                        <div>
                            <p className="text-sm font-medium text-foreground">{t("configSection.reminder24h")}</p>
                            <p className="text-xs text-muted-foreground">WhatsApp</p>
                        </div>
                        <Toggle enabled={reminder24h} onChange={setReminder24h} label={reminder24h ? t("configSection.reminderEnabled") : t("configSection.reminderDisabled")} />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-700">
                        <div>
                            <p className="text-sm font-medium text-foreground">{t("configSection.reminder1h")}</p>
                            <p className="text-xs text-muted-foreground">WhatsApp</p>
                        </div>
                        <Toggle enabled={reminder1h} onChange={setReminder1h} label={reminder1h ? t("configSection.reminderEnabled") : t("configSection.reminderDisabled")} />
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                            {t('configSection.reminderNote')}
                        </p>
                    </div>
                </div>
            </ConfigCard>

            {/* ── 4. Blocked Dates ── */}
            <ConfigCard icon={Ban} iconColor="bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"
                title={t("configSection.blockedDates")} description={t("configSection.blockedDatesDesc")}>
                {blockedDates.length > 0 ? (
                    <div className="space-y-2 mb-4">
                        {blockedDates.map(bd => (
                            <div key={bd.id} className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-700">
                                <div>
                                    <p className="text-sm font-medium text-foreground">{bd.blockedDate}</p>
                                    {bd.reason && <p className="text-xs text-muted-foreground">{bd.reason}</p>}
                                </div>
                                <button onClick={() => onDeleteBlockedDate(bd.id)} className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground mb-4">{t("configSection.noBlockedDates")}</p>
                )}
                <div className="flex gap-3">
                    <input type="date" value={newBlockedDate} onChange={e => setNewBlockedDate(e.target.value)} className={cn(inputCls, "w-44")} />
                    <input type="text" value={newBlockedReason} onChange={e => setNewBlockedReason(e.target.value)}
                        placeholder={t("configSection.reason")} className={cn(inputCls, "flex-1")} />
                    <button onClick={handleAddBlocked}
                        className="px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors cursor-pointer border-none flex items-center gap-1.5">
                        <Plus size={14} /> {t("configSection.addBlockedDate")}
                    </button>
                </div>
            </ConfigCard>

            {/* ── 5. No-Show Follow-up ── */}
            <ConfigCard icon={AlertTriangle} iconColor="bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400"
                title={t("configSection.noShow")} description={t("configSection.noShowDesc")}>
                <div className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-700">
                    <div>
                        <p className="text-sm font-medium text-foreground">{t("configSection.noShowFollowUp")}</p>
                        <p className="text-xs text-muted-foreground">{t("configSection.noShowFollowUpDesc")}</p>
                    </div>
                    <Toggle enabled={noShowFollowUp} onChange={setNoShowFollowUp} />
                </div>
            </ConfigCard>

            {/* ── 6. Calendar Mode ── */}
            <ConfigCard icon={Settings2} iconColor="bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400"
                title={t("configSection.calendarMode")} description={t("configSection.calendarModeDesc")}>
                <div className="space-y-3">
                    <label className={cn(
                        "flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all",
                        "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-500/30"
                    )}>
                        <input type="radio" name="calMode" checked readOnly className="w-4 h-4 text-indigo-500" />
                        <div>
                            <p className="text-sm font-semibold text-foreground">{t("configSection.singleCalendar")}</p>
                            <p className="text-xs text-muted-foreground">{t("configSection.singleCalendarDesc")}</p>
                        </div>
                    </label>
                    <label className="flex items-center gap-4 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 opacity-50 cursor-not-allowed">
                        <input type="radio" name="calMode" disabled className="w-4 h-4" />
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-foreground">{t("configSection.multiCalendar")}</p>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
                                    {t("configSection.multiCalendarBadge")}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{t("configSection.multiCalendarDesc")}</p>
                        </div>
                    </label>
                </div>
            </ConfigCard>
        </div>
    );
}
