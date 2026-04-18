"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Building2, Globe, Mail, Phone, Save, CheckCircle, AlertCircle, Image } from "lucide-react";

const INDUSTRY_KEYS = [
    "retail", "education", "health", "tourism", "technology",
    "professionalServices", "restaurants", "realEstate", "automotive",
    "finance", "fashionBeauty", "other",
];

const COMPANY_SIZES = ["1-10", "11-20", "21-50", "51-200", "201-1000"];

export default function CompanyPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const t = useTranslations("settings.companyPage");
    const [form, setForm] = useState({
        name: "", website: "", industry: "", companySize: "", supportEmail: "", phone: "",
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!activeTenantId) return;
        api.getSettings().then((res: any) => {
            if (res.success && res.data) {
                setForm({
                    name: res.data.companyName || res.data.company_name || "",
                    website: res.data.website || "",
                    industry: res.data.industry || "",
                    companySize: res.data.companySize || res.data.company_size || "",
                    supportEmail: res.data.supportEmail || res.data.support_email || "",
                    phone: res.data.phone || "",
                });
            }
        });
    }, [activeTenantId]);

    const handleSave = async () => {
        if (!activeTenantId) return;
        setSaving(true);
        setError("");
        try {
            const result = await api.updateSettings({
                companyName: form.name, industry: form.industry,
                website: form.website, companySize: form.companySize,
                supportEmail: form.supportEmail, phone: form.phone,
            });
            if (result.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                setError(result.error || t("errorSaving"));
            }
        } catch {
            setError(t("connectionError"));
        }
        setSaving(false);
    };

    const inputCls = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">{t("companyName")}</label>
                    <div className="relative">
                        <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={cn(inputCls, "pl-9")} />
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">{t("website")}</label>
                    <div className="relative">
                        <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." className={cn(inputCls, "pl-9")} />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">{t("industry")}</label>
                        <select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className={cn(inputCls, "cursor-pointer")}>
                            <option value="">{t("select")}</option>
                            {INDUSTRY_KEYS.map((key) => (
                                <option key={key} value={key}>{t(key)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">{t("companySize")}</label>
                        <select value={form.companySize} onChange={(e) => setForm({ ...form, companySize: e.target.value })} className={cn(inputCls, "cursor-pointer")}>
                            <option value="">{t("select")}</option>
                            {COMPANY_SIZES.map((s) => (
                                <option key={s} value={s}>{s} {t("people")}</option>
                            ))}
                            <option value="1000+">{t("moreThan1000")}</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">{t("supportEmail")}</label>
                    <div className="relative">
                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input type="email" value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} className={cn(inputCls, "pl-9")} />
                    </div>
                </div>

                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">{t("phone")}</label>
                    <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={cn(inputCls, "pl-9")} />
                    </div>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800/50">
                    <Image size={18} className="text-neutral-400" />
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        {t("logoNote")}{" "}
                        <a href="/admin/settings/media" className="text-indigo-500 hover:underline">{t("mediaBank")}</a>
                    </span>
                </div>
            </div>

            <div className="flex justify-end">
                <button onClick={handleSave} disabled={saving}
                    className={cn(
                        "flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all",
                        saved ? "bg-emerald-500" : "bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90",
                        saving && "opacity-70 cursor-wait"
                    )}>
                    {saved ? <CheckCircle size={16} /> : <Save size={16} />}
                    {saving ? t("saving") : saved ? t("saved") : t("saveChanges")}
                </button>
            </div>
        </div>
    );
}
