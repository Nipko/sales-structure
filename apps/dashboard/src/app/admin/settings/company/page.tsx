"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Building2, Globe, Mail, Phone, Save, CheckCircle, AlertCircle, Image } from "lucide-react";

const INDUSTRIES = [
    { value: "retail", label: "Retail / Comercio" },
    { value: "educación", label: "Educación" },
    { value: "salud", label: "Salud" },
    { value: "turismo", label: "Turismo / Hospitalidad" },
    { value: "tecnología", label: "Tecnología" },
    { value: "servicios_profesionales", label: "Servicios profesionales" },
    { value: "restaurantes", label: "Restaurantes / Gastronomía" },
    { value: "inmobiliaria", label: "Inmobiliaria" },
    { value: "automotriz", label: "Automotriz" },
    { value: "finanzas", label: "Finanzas / Banca" },
    { value: "moda_belleza", label: "Moda / Belleza" },
    { value: "otro", label: "Otro" },
];

const COMPANY_SIZES = [
    "1-10", "11-20", "21-50", "51-200", "201-1000", "Más de 1000",
];

export default function CompanyPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [form, setForm] = useState({
        name: "",
        website: "",
        industry: "",
        companySize: "",
        supportEmail: "",
        phone: "",
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
                    name: t.name || "",
                    website: s.website || "",
                    industry: t.industry || "",
                    companySize: s.companySize || s.orgSize || "",
                    supportEmail: s.supportEmail || "",
                    phone: s.phone || "",
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
                name: form.name,
                industry: form.industry,
                settings: {
                    website: form.website,
                    companySize: form.companySize,
                    supportEmail: form.supportEmail,
                    phone: form.phone,
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

    const inputClasses = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Empresa</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Información general de tu organización
                </p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                {/* Company name */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Nombre de la empresa
                    </label>
                    <div className="relative">
                        <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className={cn(inputClasses, "pl-9")}
                        />
                    </div>
                </div>

                {/* Website */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Sitio web
                    </label>
                    <div className="relative">
                        <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="url"
                            value={form.website}
                            onChange={(e) => setForm({ ...form, website: e.target.value })}
                            placeholder="https://..."
                            className={cn(inputClasses, "pl-9")}
                        />
                    </div>
                </div>

                {/* Industry + Company size */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            Industria
                        </label>
                        <select
                            value={form.industry}
                            onChange={(e) => setForm({ ...form, industry: e.target.value })}
                            className={cn(inputClasses, "cursor-pointer")}
                        >
                            <option value="">Seleccionar...</option>
                            {INDUSTRIES.map((i) => (
                                <option key={i.value} value={i.value}>{i.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                            Tamaño
                        </label>
                        <select
                            value={form.companySize}
                            onChange={(e) => setForm({ ...form, companySize: e.target.value })}
                            className={cn(inputClasses, "cursor-pointer")}
                        >
                            <option value="">Seleccionar...</option>
                            {COMPANY_SIZES.map((s) => (
                                <option key={s} value={s}>{s} personas</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Support email */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Email de soporte
                    </label>
                    <div className="relative">
                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="email"
                            value={form.supportEmail}
                            onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
                            placeholder="soporte@miempresa.com"
                            className={cn(inputClasses, "pl-9")}
                        />
                    </div>
                </div>

                {/* Phone */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Teléfono de contacto
                    </label>
                    <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="tel"
                            value={form.phone}
                            onChange={(e) => setForm({ ...form, phone: e.target.value })}
                            placeholder="+57 601 234 5678"
                            className={cn(inputClasses, "pl-9")}
                        />
                    </div>
                </div>

                {/* Logo link */}
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/50">
                    <Image size={18} className="text-neutral-400" />
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        Para cambiar el logo de la empresa, ve a{" "}
                        <a href="/admin/settings/media" className="text-indigo-500 hover:underline">Banco de medios</a>
                    </span>
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
                    {saving ? "Guardando..." : saved ? "Guardado" : "Guardar cambios"}
                </button>
            </div>
        </div>
    );
}
