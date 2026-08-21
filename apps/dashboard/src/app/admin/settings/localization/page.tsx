"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Globe, DollarSign, Calendar, Clock, Save, CheckCircle, AlertCircle } from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";
import { TIMEZONE_GROUPS, normalizeTimezone } from "@parallext/shared";
import { RegionalIdentityCard } from "./_components/RegionalIdentityCard";

const CURRENCIES = [
    { value: "COP", label: "COP - Peso colombiano ($)" },
    { value: "MXN", label: "MXN - Peso mexicano ($)" },
    { value: "PEN", label: "PEN - Sol peruano (S/)" },
    { value: "CLP", label: "CLP - Peso chileno ($)" },
    { value: "ARS", label: "ARS - Peso argentino ($)" },
    { value: "BRL", label: "BRL - Brazilian Real (R$)" },
    { value: "USD", label: "USD - US Dollar ($)" },
    { value: "EUR", label: "EUR - Euro (\u20ac)" },
];

const DATE_FORMATS = [
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY (31/12/2026)" },
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY (12/31/2026)" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-12-31)" },
];

const TIME_FORMATS = [
    { value: "24h", label: "24-hour (14:30)" },
    { value: "12h", label: "12-hour (2:30 PM)" },
];

const LANGUAGES = [
    { value: "es-CO", label: "Spanish (Colombia)" },
    { value: "es-MX", label: "Spanish (Mexico)" },
    { value: "es-ES", label: "Spanish (Spain)" },
    { value: "en-US", label: "English (US)" },
    { value: "pt-BR", label: "Português (Brasil)" },
];

const WEEK_STARTS = [
    { value: "monday", label: "Monday" },
    { value: "sunday", label: "Sunday" },
];

export default function LocalizationPage() {
    const t = useTranslations("settings.localizationPage");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    // Vacío, no "Bogotá y COP".
    //
    // Estos defaults se pintaban en el formulario ANTES de leer nada, así que
    // un negocio mexicano que entraba a cambiar el formato de fecha y apretaba
    // Guardar declaraba —sin verlo— que opera en Bogotá y cobra en pesos
    // colombianos. Un valor que el sistema puso para poder dibujar la pantalla
    // no puede convertirse en una decisión del dueño por apretar un botón que
    // dice otra cosa.
    const [form, setForm] = useState({
        timezone: "",
        currency: "",
        dateFormat: "DD/MM/YYYY",
        timeFormat: "24h",
        language: "",
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
                    // Sin dato guardado, el campo queda sin elegir y el
                    // `<select>` muestra "Sin definir". El fallback del backend
                    // se muestra aparte, marcado como lo que es.
                    timezone: s.timezone || "",
                    currency: s.currency || "",
                    dateFormat: s.dateFormat || "DD/MM/YYYY",
                    timeFormat: s.timeFormat || "24h",
                    language: t.language || "",
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
            // Lo que el dueño no eligió no se guarda: mandar `""` borraría un
            // valor declarado antes, y mandar el placeholder lo declararía.
            const settings: Record<string, string> = {
                dateFormat: form.dateFormat,
                timeFormat: form.timeFormat,
                weekStart: form.weekStart,
            };
            if (form.timezone) settings.timezone = form.timezone;
            if (form.currency) settings.currency = form.currency;
            const result = await api.updateTenant(tenantId, {
                ...(form.language ? { language: form.language } : {}),
                settings,
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
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {t("subtitle")}
                </p>
            </div>

            <HelpPanel
                title={tHelp("settingsLocalization.title")}
                description={tHelp("settingsLocalization.description")}
                tips={tHelp.raw("settingsLocalization.tips") as string[]}
                mediaKey="settingsLocalization"
            />

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <RegionalIdentityCard tenantId={activeTenantId || user?.tenantId} />

            <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                {/* Timezone */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <Clock size={14} className="text-neutral-400" /> {t("timezone")}
                    </label>
                    <select value={form.timezone ? normalizeTimezone(form.timezone) : ""} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={selectClasses}>
                        <option value="">{t("undefined")}</option>
                        {TIMEZONE_GROUPS.map((g) => (
                            <optgroup key={g.region} label={g.region}>
                                {g.zones.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                            </optgroup>
                        ))}
                    </select>
                </div>

                {/* Language */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <Globe size={14} className="text-neutral-400" /> {t("language")}
                    </label>
                    <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className={selectClasses}>
                        <option value="">{t("undefined")}</option>
                        {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                </div>

                {/* Currency */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <DollarSign size={14} className="text-neutral-400" /> {t("currency")}
                    </label>
                    <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={selectClasses}>
                        <option value="">{t("undefined")}</option>
                        {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                </div>

                {/* Date + Time format */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            <Calendar size={14} className="text-neutral-400" /> {t("dateFormat")}
                        </label>
                        <select value={form.dateFormat} onChange={(e) => setForm({ ...form, dateFormat: e.target.value })} className={selectClasses}>
                            {DATE_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            <Clock size={14} className="text-neutral-400" /> {t("timeFormat")}
                        </label>
                        <select value={form.timeFormat} onChange={(e) => setForm({ ...form, timeFormat: e.target.value })} className={selectClasses}>
                            {TIME_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* Week start */}
                <div>
                    <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        <Calendar size={14} className="text-neutral-400" /> {t("weekStart")}
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
