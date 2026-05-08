"use client";

/**
 * Fitness class schedule for gym tenants. Lists upcoming classes with
 * available spots vs capacity. Lets the operator add a class and
 * cancel existing ones (which auto-cancels confirmed bookings).
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    CalendarRange, Plus, X, Loader2, Save, MapPin, User, Clock, AlertTriangle,
} from "lucide-react";

interface FitnessClass {
    id: string;
    name: string;
    description?: string;
    class_type?: string;
    instructor_name?: string;
    scheduled_at: string;
    duration_minutes: number;
    max_capacity: number;
    available_spots: number;
    room?: string;
    level?: string;
    credits_required: number;
    is_cancelled: boolean;
}

const CLASS_TYPES = ["yoga", "crossfit", "spinning", "pilates", "hiit", "cardio", "fuerza", "boxeo"];
const LEVELS = ["principiante", "intermedio", "avanzado"];

export default function ClassesPage() {
    const t = useTranslations("classes");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [classes, setClasses] = useState<FitnessClass[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);

    async function load() {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const today = new Date();
            const horizon = new Date();
            horizon.setDate(horizon.getDate() + 30);
            const res = await api.listFitnessClasses(activeTenantId, {
                from: today.toISOString(),
                to: horizon.toISOString(),
            });
            if (res.success) setClasses(res.data || []);
        } finally { setLoading(false); }
    }

    useEffect(() => { load(); }, [activeTenantId]);

    async function handleCancel(id: string) {
        if (!activeTenantId) return;
        const reason = prompt(t("cancelReason"));
        if (reason === null) return;
        await api.cancelFitnessClass(activeTenantId, id, reason || undefined);
        load();
    }

    // Group classes by day for nicer scanning
    const grouped = classes.reduce((acc, c) => {
        const day = new Date(c.scheduled_at).toISOString().slice(0, 10);
        if (!acc[day]) acc[day] = [];
        acc[day].push(c);
        return acc;
    }, {} as Record<string, FitnessClass[]>);
    const days = Object.keys(grouped).sort();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <CalendarRange className="h-6 w-6 text-emerald-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
                >
                    <Plus className="h-4 w-4" /> {t("addClass")}
                </button>
            </div>

            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="skeleton h-24 w-full rounded-xl" />
                    ))}
                </div>
            ) : days.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
                    {t("noClasses")}
                </div>
            ) : (
                <div className="space-y-6">
                    {days.map(day => (
                        <div key={day}>
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                {new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {grouped[day].map(c => {
                                    const fillPct = (1 - c.available_spots / c.max_capacity) * 100;
                                    const full = c.available_spots === 0;
                                    return (
                                        <div key={c.id} className={cn("bg-card border border-border rounded-xl p-4", c.is_cancelled && "opacity-50")}>
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <div className="min-w-0">
                                                    <h3 className="font-semibold truncate">{c.name}</h3>
                                                    <p className="text-xs text-muted-foreground">
                                                        {new Date(c.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                                        {" · "}{c.duration_minutes}m
                                                    </p>
                                                </div>
                                                {c.class_type && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono uppercase">
                                                        {c.class_type}
                                                    </span>
                                                )}
                                            </div>
                                            {c.instructor_name && (
                                                <p className="text-xs flex items-center gap-1 text-muted-foreground">
                                                    <User className="h-3 w-3" /> {c.instructor_name}
                                                </p>
                                            )}
                                            {c.room && (
                                                <p className="text-xs flex items-center gap-1 text-muted-foreground">
                                                    <MapPin className="h-3 w-3" /> {c.room}
                                                </p>
                                            )}
                                            <div className="mt-3 space-y-1">
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">{t("capacity")}</span>
                                                    <span className={cn("font-mono font-semibold", full ? "text-red-600" : "text-foreground")}>
                                                        {c.max_capacity - c.available_spots} / {c.max_capacity}
                                                    </span>
                                                </div>
                                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className={cn("h-full transition-all", full ? "bg-red-500" : fillPct > 70 ? "bg-amber-500" : "bg-emerald-500")}
                                                        style={{ width: `${fillPct}%` }}
                                                    />
                                                </div>
                                            </div>
                                            {!c.is_cancelled && (
                                                <button
                                                    onClick={() => handleCancel(c.id)}
                                                    className="mt-3 w-full text-xs px-2 py-1 hover:bg-red-500/10 text-red-600 rounded transition"
                                                >
                                                    {t("cancelClass")}
                                                </button>
                                            )}
                                            {c.is_cancelled && (
                                                <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3" /> {t("cancelled")}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showForm && (
                <ClassFormModal
                    onClose={() => setShowForm(false)}
                    onCreated={() => { setShowForm(false); load(); }}
                />
            )}
        </div>
    );
}

function ClassFormModal({
    onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
    const t = useTranslations("classes");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    const [form, setForm] = useState({
        name: "",
        classType: "",
        instructorName: "",
        scheduledAt: tomorrow.toISOString().slice(0, 16),
        durationMinutes: "60",
        maxCapacity: "20",
        room: "",
        level: "",
        creditsRequired: "1",
    });
    const [busy, setBusy] = useState(false);

    async function handleSubmit() {
        if (!activeTenantId) return;
        setBusy(true);
        try {
            await api.createFitnessClass(activeTenantId, {
                name: form.name,
                classType: form.classType || undefined,
                instructorName: form.instructorName || undefined,
                scheduledAt: new Date(form.scheduledAt).toISOString(),
                durationMinutes: parseInt(form.durationMinutes, 10),
                maxCapacity: parseInt(form.maxCapacity, 10),
                room: form.room || undefined,
                level: form.level || undefined,
                creditsRequired: parseInt(form.creditsRequired, 10),
            });
            onCreated();
        } finally { setBusy(false); }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <h3 className="text-base font-semibold">{t("newClass")}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>
                <div className="p-5 space-y-3">
                    <input type="text" placeholder={t("classNamePlaceholder")} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                        <select value={form.classType} onChange={e => setForm({ ...form, classType: e.target.value })} className="bg-card border border-border rounded-lg px-3 py-2 text-sm">
                            <option value="">{t("selectType")}</option>
                            {CLASS_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} className="bg-card border border-border rounded-lg px-3 py-2 text-sm">
                            <option value="">{t("selectLevel")}</option>
                            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    <input type="text" placeholder={t("instructorPlaceholder")} value={form.instructorName} onChange={e => setForm({ ...form, instructorName: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs mb-1">{t("scheduledAt")}</label>
                            <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("duration")}</label>
                            <input type="number" value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("capacity")}</label>
                            <input type="number" value={form.maxCapacity} onChange={e => setForm({ ...form, maxCapacity: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">{t("creditsRequired")}</label>
                            <input type="number" value={form.creditsRequired} onChange={e => setForm({ ...form, creditsRequired: e.target.value })} className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                    </div>
                    <input type="text" placeholder={t("roomPlaceholder")} value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button onClick={handleSubmit} disabled={busy || !form.name} className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
