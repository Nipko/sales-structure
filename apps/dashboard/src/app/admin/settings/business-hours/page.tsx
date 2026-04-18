"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Clock, Save, CheckCircle, AlertCircle } from "lucide-react";

interface DaySchedule {
    enabled: boolean;
    open: string;
    close: string;
}

const DAYS = [
    { key: "monday", label: "Lunes" },
    { key: "tuesday", label: "Martes" },
    { key: "wednesday", label: "Miércoles" },
    { key: "thursday", label: "Jueves" },
    { key: "friday", label: "Viernes" },
    { key: "saturday", label: "Sábado" },
    { key: "sunday", label: "Domingo" },
];

const defaultSchedule: Record<string, DaySchedule> = {
    monday: { enabled: true, open: "08:00", close: "18:00" },
    tuesday: { enabled: true, open: "08:00", close: "18:00" },
    wednesday: { enabled: true, open: "08:00", close: "18:00" },
    thursday: { enabled: true, open: "08:00", close: "18:00" },
    friday: { enabled: true, open: "08:00", close: "17:00" },
    saturday: { enabled: false, open: "09:00", close: "13:00" },
    sunday: { enabled: false, open: "09:00", close: "13:00" },
};

export default function BusinessHoursPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [schedule, setSchedule] = useState<Record<string, DaySchedule>>(defaultSchedule);
    const [outOfHoursMessage, setOutOfHoursMessage] = useState(
        "Gracias por tu mensaje. Estamos fuera de nuestro horario de atención. Te responderemos a primera hora del siguiente día hábil."
    );
    const [outOfHoursEnabled, setOutOfHoursEnabled] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        async function load() {
            const tenantId = activeTenantId || user?.tenantId;
            if (!tenantId) return;
            const result = await api.getTenant(tenantId);
            if (result.success && result.data) {
                const s = (result.data as any).settings || {};
                if (s.businessHours) setSchedule(s.businessHours);
                if (s.outOfHoursMessage !== undefined) setOutOfHoursMessage(s.outOfHoursMessage);
                if (s.outOfHoursEnabled !== undefined) setOutOfHoursEnabled(s.outOfHoursEnabled);
            }
        }
        load();
    }, [activeTenantId, user?.tenantId]);

    const updateDay = (day: string, field: keyof DaySchedule, value: any) => {
        setSchedule(prev => ({
            ...prev,
            [day]: { ...prev[day], [field]: value },
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        setError("");
        try {
            const tenantId = activeTenantId || user?.tenantId;
            if (!tenantId) return;
            const result = await api.updateTenant(tenantId, {
                settings: {
                    businessHours: schedule,
                    outOfHoursEnabled,
                    outOfHoursMessage,
                },
            });
            if (result.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                setError(result.error || "Error al guardar");
            }
        } catch {
            setError("Error de conexión");
        }
        setSaving(false);
    };

    const timeClasses = "h-9 w-24 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2 text-sm text-center text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 transition-colors";

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Horarios de negocio</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Define los horarios de atención y el mensaje fuera de horario
                </p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* Schedule */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                    Horarios por día
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-5">
                    Activa los días laborables y define el horario de apertura y cierre
                </p>

                <div className="space-y-3">
                    {DAYS.map(({ key, label }) => {
                        const day = schedule[key];
                        return (
                            <div
                                key={key}
                                className={cn(
                                    "flex items-center gap-4 rounded-lg border p-3 transition-colors",
                                    day.enabled
                                        ? "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800"
                                        : "border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 opacity-60"
                                )}
                            >
                                {/* Toggle */}
                                <button
                                    onClick={() => updateDay(key, "enabled", !day.enabled)}
                                    className={cn(
                                        "relative h-5 w-10 shrink-0 cursor-pointer rounded-full border-none transition-colors",
                                        day.enabled ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                                    )}
                                >
                                    <div className={cn(
                                        "absolute top-[2px] h-4 w-4 rounded-full bg-white transition-[left] duration-200",
                                        day.enabled ? "left-[22px]" : "left-[2px]"
                                    )} />
                                </button>

                                {/* Day name */}
                                <span className="w-24 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                    {label}
                                </span>

                                {/* Time inputs */}
                                {day.enabled ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="time"
                                            value={day.open}
                                            onChange={(e) => updateDay(key, "open", e.target.value)}
                                            className={timeClasses}
                                        />
                                        <span className="text-xs text-neutral-400">a</span>
                                        <input
                                            type="time"
                                            value={day.close}
                                            onChange={(e) => updateDay(key, "close", e.target.value)}
                                            className={timeClasses}
                                        />
                                    </div>
                                ) : (
                                    <span className="text-xs text-neutral-400">Cerrado</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Out of hours */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                            Mensaje fuera de horario
                        </h2>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            Respuesta automática cuando un cliente escribe fuera del horario
                        </p>
                    </div>
                    <button
                        onClick={() => setOutOfHoursEnabled(!outOfHoursEnabled)}
                        className={cn(
                            "relative h-6 w-12 shrink-0 cursor-pointer rounded-full border-none transition-colors",
                            outOfHoursEnabled ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                        )}
                    >
                        <div className={cn(
                            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200",
                            outOfHoursEnabled ? "left-[27px]" : "left-[3px]"
                        )} />
                    </button>
                </div>

                {outOfHoursEnabled && (
                    <textarea
                        value={outOfHoursMessage}
                        onChange={(e) => setOutOfHoursMessage(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-none transition-colors"
                    />
                )}
            </div>

            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all",
                        saved ? "bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-700",
                        saving && "opacity-70 cursor-wait"
                    )}
                >
                    {saved ? <CheckCircle size={16} /> : <Save size={16} />}
                    {saving ? "Guardando..." : saved ? "Guardado" : "Guardar cambios"}
                </button>
            </div>
        </div>
    );
}
