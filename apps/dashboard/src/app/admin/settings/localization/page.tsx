"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Globe, DollarSign, Calendar, Clock, Save, CheckCircle, AlertCircle } from "lucide-react";

const TIMEZONES = [
    { value: "America/Bogota", label: "Colombia (GMT-5)" },
    { value: "America/Mexico_City", label: "México Central (GMT-6)" },
    { value: "America/Lima", label: "Perú (GMT-5)" },
    { value: "America/Santiago", label: "Chile (GMT-4)" },
    { value: "America/Argentina/Buenos_Aires", label: "Argentina (GMT-3)" },
    { value: "America/Sao_Paulo", label: "Brasil (GMT-3)" },
    { value: "America/New_York", label: "US Eastern (GMT-5)" },
    { value: "America/Chicago", label: "US Central (GMT-6)" },
    { value: "America/Los_Angeles", label: "US Pacific (GMT-8)" },
    { value: "Europe/Madrid", label: "España (GMT+1)" },
    { value: "Europe/London", label: "UK (GMT+0)" },
];

const CURRENCIES = [
    { value: "COP", label: "COP - Peso colombiano ($)" },
    { value: "MXN", label: "MXN - Peso mexicano ($)" },
    { value: "PEN", label: "PEN - Sol peruano (S/)" },
    { value: "CLP", label: "CLP - Peso chileno ($)" },
    { value: "ARS", label: "ARS - Peso argentino ($)" },
    { value: "BRL", label: "BRL - Real brasileño (R$)" },
    { value: "USD", label: "USD - Dólar estadounidense ($)" },
    { value: "EUR", label: "EUR - Euro (\u20ac)" },
];

const DATE_FORMATS = [
    { value: "DD/MM/YYYY", label: "DD/MM/AAAA (31/12/2026)" },
    { value: "MM/DD/YYYY", label: "MM/DD/AAAA (12/31/2026)" },
    { value: "YYYY-MM-DD", label: "AAAA-MM-DD (2026-12-31)" },
];

const TIME_FORMATS = [
    { value: "24h", label: "24 horas (14:30)" },
    { value: "12h", label: "12 horas (2:30 PM)" },
];

const LANGUAGES = [
    { value: "es-CO", label: "Español (Colombia)" },
    { value: "es-MX", label: "Español (México)" },
    { value: "es-ES", label: "Español (España)" },
    { value: "en-US", label: "English (US)" },
    { value: "pt-BR", label: "Português (Brasil)" },
];

const WEEK_STARTS = [
    { value: "monday", label: "Lunes" },
    { value: "sunday", label: "Domingo" },
];

export default function LocalizationPage() {
    const tc = useTranslations("common");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [form, setForm] = useState({
        timezone: "America/Bogota",
        currency: "COP",
        dateFormat: "DD/MM/YYYY",
        timeFormat: "24h",
        language: "es-CO",
        weekStart: "monday",
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        async function load() {
            const tenantId = activeTenantId || user?.tenantId;
            if (!tenantId) return;
            const result = await api.getTenant(tenantId);
            if (result.success && result.data) {
                const t = result.data as any;
                const s = t.settings || {};
                setForm({
                    timezone: s.timezone || "America/Bogota",
                    currency: s.currency || "COP",
                    dateFormat: s.dateFormat || "DD/MM/YYYY",
                    timeFormat: s.timeFormat || "24h",
                    language: t.language || "es-CO",
                    weekStart: s.weekStart || "monday",
                });
            }
        }
        load();
    }, [activeTenantId, user?.tenantId]);

    const handleSave = async () => {
        setSaving(true);
        setError("");
        try {
            const tenantId = activeTenantId || user?.tenantId;
            if (!tenantId) return;
            const result = await api.updateTenant(tenantId, {
                language: form.language,
                settings: {
                    timezone: form.timezone,
                    currency: form.currency,
                    dateFormat: form.dateFormat,
                    timeFormat: form.timeFormat,
                    weekStart: form.weekStart,
                },
            });
            if (result.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                setError(result.error || tc("errorSaving"));
            }
        } catch {
            setError(tc("connectionError"));
        }
        setSaving(false);
    };

    const selectClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-pointer transition-colors";

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Localización</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Zona horaria, moneda, formato de fecha e idioma del workspace
                </p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                {/* Timezone */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <Clock size={14} className="text-neutral-400" /> Zona horaria
                    </label>
                    <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={selectClasses}>
                        {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                    </select>
                </div>

                {/* Language */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <Globe size={14} className="text-neutral-400" /> Idioma
                    </label>
                    <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className={selectClasses}>
                        {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                </div>

                {/* Currency */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <DollarSign size={14} className="text-neutral-400" /> Moneda
                    </label>
                    <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={selectClasses}>
                        {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                </div>

                {/* Date + Time format */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            <Calendar size={14} className="text-neutral-400" /> Formato de fecha
                        </label>
                        <select value={form.dateFormat} onChange={(e) => setForm({ ...form, dateFormat: e.target.value })} className={selectClasses}>
                            {DATE_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            <Clock size={14} className="text-neutral-400" /> Formato de hora
                        </label>
                        <select value={form.timeFormat} onChange={(e) => setForm({ ...form, timeFormat: e.target.value })} className={selectClasses}>
                            {TIME_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* Week start */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <Calendar size={14} className="text-neutral-400" /> Primer día de la semana
                    </label>
                    <select value={form.weekStart} onChange={(e) => setForm({ ...form, weekStart: e.target.value })} className={selectClasses}>
                        {WEEK_STARTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                </div>
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
                    {saving ? tc("saving") : saved ? tc("saved") : tc("saveChanges")}
                </button>
            </div>
        </div>
    );
}
