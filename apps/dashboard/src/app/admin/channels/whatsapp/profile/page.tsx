"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    ArrowLeft, Building2, RefreshCw, Loader2, Camera, Trash2, Save,
    CheckCircle, AlertTriangle, XCircle, Clock, Info, Shield, Globe,
    MessageSquare, BadgeCheck, Smartphone, Radio, HelpCircle,
} from "lucide-react";
import { HelpPanel } from "@/components/ui/help-panel";

const VERTICALS = [
    "UNDEFINED", "OTHER", "AUTO", "BEAUTY", "APPAREL", "EDU", "ENTERTAIN",
    "EVENT_PLAN", "FINANCE", "GROCERY", "GOVT", "HOTEL", "HEALTH",
    "NONPROFIT", "PROF_SERVICES", "RETAIL", "TRAVEL", "RESTAURANT", "NOT_A_BIZ",
] as const;

const VERTICAL_KEYS: Record<string, string> = {
    UNDEFINED: "verticalUndefined", OTHER: "verticalOther", AUTO: "verticalAuto",
    BEAUTY: "verticalBeauty", APPAREL: "verticalApparel", EDU: "verticalEdu",
    ENTERTAIN: "verticalEntertain", EVENT_PLAN: "verticalEvent_plan",
    FINANCE: "verticalFinance", GROCERY: "verticalGrocery", GOVT: "verticalGovt",
    HOTEL: "verticalHotel", HEALTH: "verticalHealth", NONPROFIT: "verticalNonprofit",
    PROF_SERVICES: "verticalProf_services", RETAIL: "verticalRetail",
    TRAVEL: "verticalTravel", RESTAURANT: "verticalRestaurant", NOT_A_BIZ: "verticalNot_a_biz",
};

const FIELD_LIMITS = { about: 139, description: 512, address: 256, email: 128 };

interface PhoneDetails {
    verified_name?: string;
    name_status?: string;
    quality_rating?: string;
    messaging_limit_tier?: string;
    is_official_business_account?: boolean;
    account_mode?: string;
    code_verification_status?: string;
    display_phone_number?: string;
}

interface Profile {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    profile_picture_url?: string;
    websites?: string[];
    vertical?: string;
}

export default function WhatsAppProfilePage() {
    const t = useTranslations("whatsappProfile");
    const tc = useTranslations("common");
    const tHelp = useTranslations("help");
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const [profile, setProfile] = useState<Profile>({});
    const [phoneDetails, setPhoneDetails] = useState<PhoneDetails>({});
    const [form, setForm] = useState({ about: "", description: "", email: "", address: "", website1: "", website2: "", vertical: "UNDEFINED" });
    const [initialForm, setInitialForm] = useState(form);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    async function loadProfile(showRefresh = false) {
        if (showRefresh) setRefreshing(true); else setLoading(true);
        setFeedback(null);
        try {
            const res = await api.getWhatsappBusinessProfile();
            if (res.success && res.data) {
                const p: Profile = res.data.profile || {};
                const pd: PhoneDetails = res.data.phoneDetails || {};
                setProfile(p);
                setPhoneDetails(pd);
                const f = {
                    about: p.about || "",
                    description: p.description || "",
                    email: p.email || "",
                    address: p.address || "",
                    website1: p.websites?.[0] || "",
                    website2: p.websites?.[1] || "",
                    vertical: p.vertical || "UNDEFINED",
                };
                setForm(f);
                setInitialForm(f);
            } else {
                setFeedback({ type: "error", text: res.error || t("loadError") });
            }
        } catch {
            setFeedback({ type: "error", text: t("loadError") });
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    useEffect(() => { loadProfile(); }, []);

    const hasChanges = JSON.stringify(form) !== JSON.stringify(initialForm);

    async function handleSave() {
        if (!hasChanges) return;
        setSaving(true);
        setFeedback(null);
        const websites: string[] = [];
        if (form.website1.trim()) websites.push(form.website1.trim());
        if (form.website2.trim()) websites.push(form.website2.trim());
        try {
            const res = await api.updateWhatsappBusinessProfile({
                about: form.about, description: form.description, email: form.email,
                address: form.address, websites, vertical: form.vertical,
            });
            if (res.success) {
                setFeedback({ type: "success", text: t("formSaved") });
                loadProfile(true);
            } else {
                setFeedback({ type: "error", text: res.error || t("formError") });
            }
        } catch {
            setFeedback({ type: "error", text: t("formError") });
        } finally {
            setSaving(false);
        }
    }

    async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.match(/^image\/(jpeg|png)$/)) {
            setFeedback({ type: "error", text: t("photoInvalidType") });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setFeedback({ type: "error", text: t("photoTooLarge") });
            return;
        }
        setPhotoPreview(URL.createObjectURL(file));
        setUploading(true);
        setFeedback(null);
        try {
            const res = await api.uploadWhatsappProfilePhoto(file);
            if (res.success) {
                setFeedback({ type: "success", text: t("photoSuccess") });
                loadProfile(true);
            } else {
                setFeedback({ type: "error", text: res.error || t("photoError") });
                setPhotoPreview(null);
            }
        } catch {
            setFeedback({ type: "error", text: t("photoError") });
            setPhotoPreview(null);
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    }

    async function handleDeletePhoto() {
        if (!confirm(t("photoDeleteConfirm"))) return;
        setUploading(true);
        try {
            const res = await api.deleteWhatsappProfilePhoto();
            if (res.success) {
                setFeedback({ type: "success", text: t("photoDeleted") });
                setPhotoPreview(null);
                loadProfile(true);
            }
        } catch {
            setFeedback({ type: "error", text: t("photoError") });
        } finally {
            setUploading(false);
        }
    }

    function CharCounter({ value, max }: { value: string; max: number }) {
        const remaining = max - value.length;
        return (
            <span className={cn("text-[11px]", remaining < 0 ? "text-red-500" : remaining < 20 ? "text-amber-500" : "text-muted-foreground")}>
                {value.length}/{max}
            </span>
        );
    }

    // ── Status helpers ──
    function nameStatusConfig(status?: string) {
        switch (status) {
            case "APPROVED": return { label: t("nameStatusApproved"), color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20", icon: CheckCircle, help: t("nameHelpApproved") };
            case "PENDING_REVIEW": return { label: t("nameStatusPending"), color: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20", icon: Clock, help: t("nameHelpPending") };
            case "DECLINED": return { label: t("nameStatusDeclined"), color: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20", icon: XCircle, help: t("nameHelpDeclined") };
            case "EXPIRED": return { label: t("nameStatusExpired"), color: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20", icon: AlertTriangle, help: t("nameHelpExpired") };
            case "AVAILABLE_WITHOUT_REVIEW": return { label: t("nameStatusAvailable"), color: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20", icon: CheckCircle, help: t("nameHelpAvailable") };
            default: return { label: t("nameStatusNone"), color: "bg-muted text-muted-foreground border-border", icon: HelpCircle, help: t("nameHelpNone") };
        }
    }

    function qualityConfig(rating?: string) {
        switch (rating) {
            case "GREEN": return { label: t("qualityGreen"), color: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", help: t("qualityHelpGreen") };
            case "YELLOW": return { label: t("qualityYellow"), color: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500", help: t("qualityHelpYellow") };
            case "RED": return { label: t("qualityRed"), color: "text-red-600 dark:text-red-400", dot: "bg-red-500", help: t("qualityHelpRed") };
            default: return { label: "—", color: "text-muted-foreground", dot: "bg-muted-foreground", help: "" };
        }
    }

    function tierLabel(limit?: string) {
        if (!limit) return "—";
        if (limit.includes("UNLIMITED")) return t("tierUnlimited");
        if (limit.includes("100K") || limit.includes("100000")) return t("tier100k");
        if (limit.includes("10K") || limit.includes("10000")) return t("tier10k");
        if (limit.includes("1K") || limit.includes("1000")) return t("tier1k");
        return limit;
    }

    const isNewNumber = (!phoneDetails.name_status || phoneDetails.name_status === "NONE" || phoneDetails.name_status === "AVAILABLE_WITHOUT_REVIEW")
        && !profile.description && !profile.about;

    if (loading) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">{t("loading")}</span>
                </div>
            </div>
        );
    }

    const ns = nameStatusConfig(phoneDetails.name_status);
    const ql = qualityConfig(phoneDetails.quality_rating);
    const NameIcon = ns.icon;

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <button onClick={() => router.push("/admin/channels/whatsapp")} className="p-2 rounded-lg hover:bg-muted transition-colors">
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div>
                        <h1 className="text-lg font-semibold flex items-center gap-2">
                            <Building2 className="h-5 w-5 text-emerald-500" />
                            {t("title")}
                        </h1>
                        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
                    </div>
                </div>
                <button onClick={() => loadProfile(true)} disabled={refreshing} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors inline-flex items-center gap-2 disabled:opacity-50">
                    <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    {refreshing ? t("refreshing") : t("refresh")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("channelsWhatsappProfile.title")}
                description={tHelp("channelsWhatsappProfile.description")}
                tips={tHelp.raw("channelsWhatsappProfile.tips") as string[]}
                mediaKey="channelsWhatsappProfile"
            />

            {/* Feedback */}
            {feedback && (
                <div className={cn(
                    "px-4 py-3 rounded-lg text-sm border flex items-start gap-2",
                    feedback.type === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
                    feedback.type === "error" && "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
                )}>
                    {feedback.type === "success" ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
                    <span>{feedback.text}</span>
                </div>
            )}

            {/* New number guidance banner */}
            {isNewNumber && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        {t("newNumberBannerTitle")}
                    </h3>
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">{t("newNumberBannerBody")}</p>
                    <ol className="mt-3 space-y-1 text-sm text-blue-600 dark:text-blue-400 list-decimal list-inside">
                        <li>{t("newNumberStep1")}</li>
                        <li>{t("newNumberStep2")}</li>
                        <li>{t("newNumberStep3")}</li>
                        <li>{t("newNumberStep4")}</li>
                        <li>{t("newNumberStep5")}</li>
                    </ol>
                </div>
            )}

            {/* Verification & Status Panel */}
            <div className={cn(
                "bg-card border rounded-xl overflow-hidden",
                phoneDetails.name_status === "DECLINED" || phoneDetails.quality_rating === "RED" ? "border-red-500/30" :
                phoneDetails.name_status === "PENDING_REVIEW" || phoneDetails.quality_rating === "YELLOW" ? "border-amber-500/30" :
                "border-border",
            )}>
                <div className="p-4 border-b border-border">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                        <Shield className="h-4 w-4 text-indigo-500" />
                        {t("statusTitle")}
                    </h2>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Display Name */}
                    <div className="space-y-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("displayName")}</span>
                        <p className="text-sm font-medium">{phoneDetails.verified_name || phoneDetails.display_phone_number || "—"}</p>
                    </div>

                    {/* Name Status */}
                    <div className="space-y-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("nameStatus")}</span>
                        <div className="flex items-center gap-2">
                            <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-1", ns.color)}>
                                <NameIcon className="h-3 w-3" />
                                {ns.label}
                            </span>
                        </div>
                        {ns.help && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{ns.help}</p>}
                    </div>

                    {/* Quality Rating */}
                    <div className="space-y-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("qualityRating")}</span>
                        <div className="flex items-center gap-2">
                            <span className={cn("h-2.5 w-2.5 rounded-full", ql.dot)} />
                            <span className={cn("text-sm font-medium", ql.color)}>{ql.label}</span>
                        </div>
                        {ql.help && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{ql.help}</p>}
                    </div>

                    {/* Messaging Limit */}
                    <div className="space-y-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("messagingLimit")}</span>
                        <p className="text-sm font-medium flex items-center gap-2">
                            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                            {tierLabel(phoneDetails.messaging_limit_tier)}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-snug">{t("tierHelp")}</p>
                    </div>

                    {/* Official Business Account */}
                    <div className="space-y-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("officialAccount")}</span>
                        <p className="text-sm font-medium flex items-center gap-2">
                            {phoneDetails.is_official_business_account
                                ? <><BadgeCheck className="h-4 w-4 text-emerald-500" /><span className="text-emerald-600 dark:text-emerald-400">{t("officialYes")}</span></>
                                : <><Globe className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{t("officialNo")}</span></>
                            }
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-snug">{t("officialHelp")}</p>
                    </div>

                    {/* Account Mode */}
                    <div className="space-y-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("accountMode")}</span>
                        <p className="text-sm font-medium flex items-center gap-2">
                            <Radio className="h-3.5 w-3.5 text-muted-foreground" />
                            {phoneDetails.account_mode === "SANDBOX"
                                ? <span className="text-amber-600 dark:text-amber-400">{t("modeSandbox")}</span>
                                : <span className="text-emerald-600 dark:text-emerald-400">{t("modeLive")}</span>
                            }
                        </p>
                        {phoneDetails.account_mode === "SANDBOX" && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">{t("modeHelpSandbox")}</p>
                        )}
                    </div>

                    {/* Phone Verification */}
                    <div className="space-y-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("phoneVerification")}</span>
                        <p className="text-sm font-medium flex items-center gap-2">
                            <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                            {phoneDetails.code_verification_status === "VERIFIED"
                                ? <span className="text-emerald-600 dark:text-emerald-400">{t("phoneVerified")}</span>
                                : <span className="text-muted-foreground">{t("phoneNotVerified")}</span>
                            }
                        </p>
                    </div>
                </div>
            </div>

            {/* Profile Photo */}
            <div className="bg-card border border-border rounded-xl">
                <div className="p-4 border-b border-border">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                        <Camera className="h-4 w-4 text-violet-500" />
                        {t("photoTitle")}
                    </h2>
                </div>
                <div className="p-4 flex items-center gap-6">
                    <div className="relative">
                        {(photoPreview || profile.profile_picture_url) ? (
                            <img
                                src={photoPreview || profile.profile_picture_url}
                                alt="Profile"
                                className="h-24 w-24 rounded-full object-cover border-2 border-border"
                            />
                        ) : (
                            <div className="h-24 w-24 rounded-full bg-muted border-2 border-dashed border-border flex items-center justify-center">
                                <Camera className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                        )}
                        {uploading && (
                            <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-white" />
                            </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => fileRef.current?.click()}
                                disabled={uploading}
                                className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-2 transition-colors"
                            >
                                <Camera className="h-4 w-4" />
                                {uploading ? t("photoUploading") : t("photoUpload")}
                            </button>
                            {profile.profile_picture_url && (
                                <button
                                    onClick={handleDeletePhoto}
                                    disabled={uploading}
                                    className="px-3 py-2 text-sm border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg inline-flex items-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    {t("photoDelete")}
                                </button>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">{t("photoGuidance")}</p>
                        <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handlePhotoUpload} />
                    </div>
                </div>
            </div>

            {/* Profile Information Form */}
            <div className="bg-card border border-border rounded-xl">
                <div className="p-4 border-b border-border">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                        <Info className="h-4 w-4 text-cyan-500" />
                        {t("formTitle")}
                    </h2>
                </div>
                <div className="p-4 space-y-4">
                    {/* About */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">{t("fieldAbout")}</label>
                            <CharCounter value={form.about} max={FIELD_LIMITS.about} />
                        </div>
                        <input
                            type="text"
                            value={form.about}
                            onChange={e => setForm({ ...form, about: e.target.value })}
                            maxLength={FIELD_LIMITS.about}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                            placeholder={t("fieldAboutPlaceholder")}
                        />
                        <p className="text-[11px] text-muted-foreground">{t("fieldAboutHelp")}</p>
                    </div>

                    {/* Description */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">{t("fieldDescription")}</label>
                            <CharCounter value={form.description} max={FIELD_LIMITS.description} />
                        </div>
                        <textarea
                            rows={3}
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            maxLength={FIELD_LIMITS.description}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm resize-none"
                            placeholder={t("fieldDescriptionPlaceholder")}
                        />
                        <p className="text-[11px] text-muted-foreground">{t("fieldDescriptionHelp")}</p>
                    </div>

                    {/* Email */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">{t("fieldEmail")}</label>
                            <CharCounter value={form.email} max={FIELD_LIMITS.email} />
                        </div>
                        <input
                            type="email"
                            value={form.email}
                            onChange={e => setForm({ ...form, email: e.target.value })}
                            maxLength={FIELD_LIMITS.email}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                            placeholder="contacto@empresa.com"
                        />
                        <p className="text-[11px] text-muted-foreground">{t("fieldEmailHelp")}</p>
                    </div>

                    {/* Address */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium">{t("fieldAddress")}</label>
                            <CharCounter value={form.address} max={FIELD_LIMITS.address} />
                        </div>
                        <input
                            type="text"
                            value={form.address}
                            onChange={e => setForm({ ...form, address: e.target.value })}
                            maxLength={FIELD_LIMITS.address}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                            placeholder={t("fieldAddressPlaceholder")}
                        />
                        <p className="text-[11px] text-muted-foreground">{t("fieldAddressHelp")}</p>
                    </div>

                    {/* Websites */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">{t("fieldWebsites")}</label>
                        <div className="space-y-2">
                            <input
                                type="url"
                                value={form.website1}
                                onChange={e => setForm({ ...form, website1: e.target.value })}
                                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                                placeholder="https://www.ejemplo.com"
                            />
                            <input
                                type="url"
                                value={form.website2}
                                onChange={e => setForm({ ...form, website2: e.target.value })}
                                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                                placeholder="https://tienda.ejemplo.com"
                            />
                        </div>
                        <p className="text-[11px] text-muted-foreground">{t("fieldWebsitesHelp")}</p>
                    </div>

                    {/* Vertical / Industry */}
                    <div className="space-y-1">
                        <label className="text-sm font-medium">{t("fieldVertical")}</label>
                        <select
                            value={form.vertical}
                            onChange={e => setForm({ ...form, vertical: e.target.value })}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                        >
                            {VERTICALS.map(v => (
                                <option key={v} value={v}>{t(VERTICAL_KEYS[v] as any)}</option>
                            ))}
                        </select>
                        <p className="text-[11px] text-muted-foreground">{t("fieldVerticalHelp")}</p>
                    </div>
                </div>

                {/* Save bar */}
                <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                        {hasChanges ? t("formHasChanges") : t("formNoChanges")}
                    </p>
                    <button
                        onClick={handleSave}
                        disabled={!hasChanges || saving}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {saving ? t("formSaving") : t("formSave")}
                    </button>
                </div>
            </div>
        </div>
    );
}
