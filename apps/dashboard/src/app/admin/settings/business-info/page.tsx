"use client";

import { useState, useEffect, useRef } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Building2, Save, CheckCircle, AlertCircle, Globe, Mail, Phone, MapPin, Info, Upload, Loader2, Link2, Image as ImageIcon } from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

type SocialLinks = {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    youtube?: string;
    tiktok?: string;
};

type BusinessForm = {
    companyName: string;
    industry: string;
    about: string;
    phone: string;
    email: string;
    website: string;
    address: string;
    city: string;
    country: string;
    logoUrl: string;
    socialLinks: SocialLinks;
};

const EMPTY: BusinessForm = {
    companyName: "",
    industry: "",
    about: "",
    phone: "",
    email: "",
    website: "",
    address: "",
    city: "",
    country: "",
    logoUrl: "",
    socialLinks: {},
};

function logoFullUrl(relative: string): string {
    if (!relative) return "";
    if (relative.startsWith("http")) return relative;
    const base = (process.env.NEXT_PUBLIC_API_URL || "")
        .replace(/\/api\/v1\/?$/, "");
    return `${base}${relative}`;
}

export default function BusinessInfoPage() {
    const { activeTenantId } = useTenant();
    const t = useTranslations("settings.businessInfo");
    const tHelp = useTranslations("help");
    const [form, setForm] = useState<BusinessForm>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");
    const [logoMode, setLogoMode] = useState<"upload" | "url">("upload");
    const [uploading, setUploading] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!activeTenantId) return;
        setLoading(true);
        api.getBusinessInfo(activeTenantId).then((res: any) => {
            if (res.success && res.data) {
                const logoUrl = res.data.logoUrl || "";
                setForm({
                    companyName: res.data.companyName || "",
                    industry: res.data.industry || "",
                    about: res.data.about || "",
                    phone: res.data.phone || "",
                    email: res.data.email || "",
                    website: res.data.website || "",
                    address: res.data.address || "",
                    city: res.data.city || "",
                    country: res.data.country || "",
                    logoUrl,
                    socialLinks: res.data.socialLinks || {},
                });
                if (logoUrl && logoUrl.startsWith("http")) {
                    setLogoMode("url");
                }
            }
            setLoading(false);
        });
    }, [activeTenantId]);

    const handleSave = async () => {
        if (!activeTenantId) return;
        if (!form.companyName.trim()) {
            setError(t("errors.companyNameRequired"));
            return;
        }
        setSaving(true);
        setError("");
        try {
            const result = await api.updateBusinessInfo(activeTenantId, form);
            if (result.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
                setToast(t("toast.saved"));
                setTimeout(() => setToast(null), 2500);
                window.dispatchEvent(new CustomEvent("logo-changed", { detail: { logoUrl: form.logoUrl } }));
            } else {
                setError(result.error || t("errors.saveFailed"));
            }
        } catch {
            setError(t("errors.connection"));
        }
        setSaving(false);
    };

    const handleLogoUpload = async (file: File) => {
        if (!activeTenantId) return;
        if (!file.type.startsWith("image/")) return;
        if (file.size > 5 * 1024 * 1024) return;
        setUploading(true);
        try {
            const res = await api.uploadLogo(activeTenantId, file);
            if (res.success && res.data?.logoUrl) {
                setForm(prev => ({ ...prev, logoUrl: res.data.logoUrl }));
                window.dispatchEvent(new CustomEvent("logo-changed", { detail: { logoUrl: res.data.logoUrl } }));
                setToast(t("toast.logoUploaded"));
                setTimeout(() => setToast(null), 2500);
            }
        } catch {
            setToast(t("toast.logoError"));
            setTimeout(() => setToast(null), 2500);
        }
        setUploading(false);
    };

    const setField = <K extends keyof BusinessForm>(k: K, v: BusinessForm[K]) =>
        setForm(prev => ({ ...prev, [k]: v }));

    const setSocial = (k: keyof SocialLinks, v: string) =>
        setForm(prev => ({ ...prev, socialLinks: { ...prev.socialLinks, [k]: v } }));

    const inputCls = "w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors";
    const textareaCls = "w-full min-h-[100px] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors resize-y";
    const labelCls = "block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5";
    const sectionCls = "rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5";

    if (loading) {
        return <div className="text-sm text-neutral-500 dark:text-neutral-400">{t("loading")}</div>;
    }

    const previewUrl = logoFullUrl(form.logoUrl);

    return (
        <div className="max-w-3xl space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                    <Building2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                    {t("title")}
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("subtitle")}</p>
            </div>

            <HelpPanel
                title={tHelp("settingsBusinessInfo.title")}
                description={tHelp("settingsBusinessInfo.description")}
                tips={tHelp.raw("settingsBusinessInfo.tips") as string[]}
                mediaKey="settingsBusinessInfo"
            />

            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 flex gap-2">
                <Info size={16} className="flex-shrink-0 mt-0.5" />
                <span>{t("hint")}</span>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={16} /> {error}
                </div>
            )}
            {saved && (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-600 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400">
                    <CheckCircle size={16} /> {t("saved")}
                </div>
            )}

            {/* Identity */}
            <section className={sectionCls}>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("sections.identity")}</h2>
                <div className="space-y-4">
                    <div>
                        <label className={labelCls}>{t("fields.companyName")} *</label>
                        <input className={inputCls} value={form.companyName} onChange={e => setField("companyName", e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>{t("fields.industry")}</label>
                            <input className={inputCls} value={form.industry} onChange={e => setField("industry", e.target.value)} placeholder={t("placeholders.industry")} />
                        </div>
                        <div>
                            <label className={labelCls}>{t("fields.website")}</label>
                            <input className={inputCls} value={form.website} onChange={e => setField("website", e.target.value)} placeholder="https://" />
                        </div>
                    </div>
                    <div>
                        <label className={labelCls}>{t("fields.about")}</label>
                        <textarea className={textareaCls} value={form.about} onChange={e => setField("about", e.target.value)} placeholder={t("placeholders.about")} />
                    </div>

                    {/* Logo */}
                    <div>
                        <label className={labelCls}>
                            <ImageIcon size={12} className="inline mr-1" />
                            {t("fields.logoUrl")}
                        </label>

                        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ""; }} />

                        {/* Clickable drop zone */}
                        <button
                            type="button"
                            onClick={() => { if (logoMode === "upload") fileRef.current?.click(); }}
                            disabled={uploading || logoMode === "url"}
                            className={`w-full rounded-xl border-2 border-dashed p-4 transition-all ${logoMode === "upload" ? "border-indigo-300 dark:border-indigo-500/40 hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5 cursor-pointer" : "border-neutral-200 dark:border-neutral-700 cursor-default"} bg-neutral-50 dark:bg-neutral-800/50`}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex items-center justify-center overflow-hidden shrink-0">
                                    {previewUrl ? (
                                        <img src={previewUrl} alt="Logo" className="w-full h-full object-contain p-1" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                    ) : (
                                        <Building2 size={24} className="text-neutral-300 dark:text-neutral-600" />
                                    )}
                                </div>
                                <div className="flex-1 text-left">
                                    {uploading ? (
                                        <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
                                            <Loader2 size={16} className="animate-spin" />
                                            {t("logoUploading")}
                                        </div>
                                    ) : logoMode === "upload" ? (
                                        <>
                                            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                                                <Upload size={14} />
                                                {previewUrl ? t("logoChangeFile") : t("logoChooseFile")}
                                            </p>
                                            <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">JPG, PNG, WebP, GIF — Max 5 MB</p>
                                        </>
                                    ) : null}
                                </div>
                            </div>
                        </button>

                        {/* Mode toggle */}
                        <div className="flex items-center gap-2 mt-2">
                            <button
                                type="button"
                                onClick={() => setLogoMode("upload")}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${logoMode === "upload" ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
                            >
                                <Upload size={11} className="inline mr-1" />
                                {t("logoUpload")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setLogoMode("url")}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${logoMode === "url" ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
                            >
                                <Link2 size={11} className="inline mr-1" />
                                {t("logoLink")}
                            </button>
                        </div>

                        {logoMode === "url" && (
                            <input
                                className={`${inputCls} mt-2`}
                                value={form.logoUrl}
                                onChange={e => setField("logoUrl", e.target.value)}
                                placeholder="https://cdn.example.com/logo.png"
                            />
                        )}
                    </div>
                </div>
            </section>

            {/* Contact */}
            <section className={sectionCls}>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">{t("sections.contact")}</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}><Phone size={12} className="inline mr-1" />{t("fields.phone")}</label>
                        <input className={inputCls} value={form.phone} onChange={e => setField("phone", e.target.value)} placeholder="+57 300 000 0000" />
                    </div>
                    <div>
                        <label className={labelCls}><Mail size={12} className="inline mr-1" />{t("fields.email")}</label>
                        <input className={inputCls} type="email" value={form.email} onChange={e => setField("email", e.target.value)} placeholder="contact@company.com" />
                    </div>
                </div>
            </section>

            {/* Location */}
            <section className={sectionCls}>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
                    <MapPin size={16} /> {t("sections.location")}
                </h2>
                <div className="space-y-4">
                    <div>
                        <label className={labelCls}>{t("fields.address")}</label>
                        <input className={inputCls} value={form.address} onChange={e => setField("address", e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>{t("fields.city")}</label>
                            <input className={inputCls} value={form.city} onChange={e => setField("city", e.target.value)} />
                        </div>
                        <div>
                            <label className={labelCls}>{t("fields.country")}</label>
                            <input className={inputCls} value={form.country} onChange={e => setField("country", e.target.value)} placeholder="CO" />
                        </div>
                    </div>
                </div>
            </section>

            {/* Social Links */}
            <section className={sectionCls}>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
                    <Globe size={16} /> {t("sections.social")}
                </h2>
                <div className="grid grid-cols-2 gap-4">
                    {(["facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok"] as const).map((platform) => (
                        <div key={platform}>
                            <label className={labelCls}>{t(`social.${platform}`)}</label>
                            <input
                                className={inputCls}
                                value={form.socialLinks[platform] || ""}
                                onChange={e => setSocial(platform, e.target.value)}
                                placeholder="https://"
                            />
                        </div>
                    ))}
                </div>
            </section>

            <div className="flex justify-end sticky bottom-4 bg-neutral-50 dark:bg-neutral-950 py-3">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 px-4 py-2 text-sm font-medium text-white transition-colors"
                >
                    <Save size={16} />
                    {saving ? t("saving") : t("save")}
                </button>
            </div>

            {toast && (
                <div className="fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-lg animate-in bg-emerald-500">
                    {toast}
                </div>
            )}
        </div>
    );
}
