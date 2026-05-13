"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
    Target, Headphones, Calendar, ShoppingCart, Building, UtensilsCrossed,
    ChevronRight, ChevronLeft, Check, Sparkles, MessageSquare, Loader2,
    Zap, Clock, Plane, MapPin, Car, Wrench, Heart, BookOpen, GraduationCap,
    Scale, Cpu, Briefcase, Home, Globe, Stethoscope, PawPrint,
} from "lucide-react";
import AnimatedLogo from "@/components/AnimatedLogo";

const ICON_MAP: Record<string, any> = {
    target: Target, headphones: Headphones, calendar: Calendar,
    "shopping-cart": ShoppingCart, building: Building, utensils: UtensilsCrossed,
    plane: Plane, "map-pin": MapPin, car: Car, wrench: Wrench,
    heart: Heart, "book-open": BookOpen, "graduation-cap": GraduationCap,
    scale: Scale, cpu: Cpu, briefcase: Briefcase, home: Home,
    globe: Globe, sparkles: Sparkles, stethoscope: Stethoscope,
    "paw-print": PawPrint,
};

const CHANNELS = [
    { id: "whatsapp", key: "whatsapp", color: "#25D366" },
    { id: "instagram", key: "instagram", color: "#E4405F" },
    { id: "messenger", key: "messenger", color: "#0084FF" },
    { id: "telegram", key: "telegram", color: "#0088CC" },
];

const CAPABILITIES = [
    { id: "appointments", icon: Calendar, toolKey: "appointments" },
    { id: "catalog", icon: ShoppingCart, toolKey: "catalog" },
    { id: "crm", icon: Target, toolKey: "crm" },
    { id: "knowledge", icon: BookOpen, toolKey: "knowledge" },
    { id: "faqs", icon: Headphones, toolKey: "faqs" },
    { id: "offers", icon: Zap, toolKey: "offers" },
];

function getToolBadges(tmpl: any): string[] {
    const cfg = tmpl.config || tmpl.config_json || {};
    const badges: string[] = [];
    if (cfg.tools?.appointments?.enabled) badges.push("appointments");
    if (cfg.rag?.enabled) badges.push("knowledge");
    return badges;
}

export default function SetupWizardPage() {
    const t = useTranslations("setupWizard");
    const { user } = useAuth();
    const router = useRouter();
    const tenantId = user?.tenantId;

    const [step, setStep] = useState(0);
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
    const [agentName, setAgentName] = useState("");
    const [greeting, setGreeting] = useState("");
    const [tone, setTone] = useState("amigable");
    const [is247, setIs247] = useState(true);
    const [selectedChannels, setSelectedChannels] = useState<string[]>(["whatsapp"]);
    const [enabledCapabilities, setEnabledCapabilities] = useState<string[]>([]);

    useEffect(() => {
        if (!tenantId) return;
        api.getPersonaTemplates(tenantId).then(res => {
            if (res.success) setTemplates(res.data || []);
            setLoading(false);
        });
    }, [tenantId]);

    const verticalTemplates = templates.filter(tmpl => tmpl.name && !tmpl.nameKey);
    const builtinTemplates = templates.filter(tmpl => tmpl.nameKey);

    const handleSelectTemplate = (tmpl: any) => {
        const cfg = tmpl.config || tmpl.config_json;
        if (!cfg?.persona) return;
        setSelectedTemplate(tmpl);
        setAgentName(cfg.persona.name || "");
        setGreeting(cfg.persona.greeting || "");
        setTone(cfg.persona.personality?.tone || "amigable");
    };

    const toggleChannel = (id: string) => {
        setSelectedChannels(prev =>
            prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
        );
    };

    const toggleCapability = (id: string) => {
        setEnabledCapabilities(prev =>
            prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
        );
    };

    const handleFinish = async () => {
        if (!tenantId || !selectedTemplate) {
            await handleSkip();
            return;
        }
        setSaving(true);
        let templateApplied = false;
        try {
            const result = await api.applySetupTemplate(tenantId, {
                templateId: selectedTemplate.id,
                customizations: { agentName, greeting, tone, enabledCapabilities, is247 },
                selectedChannels,
            });
            templateApplied = !!(result as any)?.success;
            if (!templateApplied) {
                console.warn("[setup-wizard] applySetupTemplate failed:", (result as any)?.error);
            }
        } catch (e) {
            console.error("[setup-wizard] applySetupTemplate threw:", e);
        } finally {
            setSaving(false);
        }
        if (!templateApplied) {
            try { await api.skipSetupWizard(tenantId); } catch { /* swallow */ }
        }
        window.location.href = "/admin";
    };

    const handleSkip = async () => {
        if (!tenantId) { router.push("/admin"); return; }
        try {
            await api.skipSetupWizard(tenantId);
        } catch (e) {
            console.error("[setup-wizard] skipSetupWizard threw:", e);
        }
        window.location.href = "/admin";
    };

    const STEPS = [
        { key: "step1Title", icon: Sparkles },
        { key: "step2Title", icon: Zap },
        { key: "step3Title", icon: MessageSquare },
    ];

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#0a0a14]">
                <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
        );
    }

    const renderTemplateCard = (tmpl: any, idx: number, isRecommended: boolean) => {
        const Icon = ICON_MAP[tmpl.icon] || Target;
        const isSelected = selectedTemplate?.id === tmpl.id;
        const badges = getToolBadges(tmpl);
        const name = tmpl.nameKey ? t(tmpl.nameKey) : (tmpl.name || tmpl.id);
        const desc = tmpl.descKey ? t(tmpl.descKey) : (tmpl.description || "");

        return (
            <button
                key={tmpl.id}
                onClick={() => handleSelectTemplate(tmpl)}
                className={`p-5 rounded-xl border text-left transition-all relative ${
                    isSelected
                        ? "border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10 ring-1 ring-indigo-500/30"
                        : "border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/30"
                }`}
            >
                {isRecommended && idx === 0 && (
                    <span className="absolute -top-2.5 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500 text-white">
                        {t("templates.recommended")}
                    </span>
                )}
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 mb-3">
                    <Icon size={20} />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1 truncate">{name}</p>
                <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2 mb-3">{desc}</p>
                {badges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {badges.map(badge => (
                            <span key={badge} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-medium">
                                {badge === "appointments" && <Calendar size={10} />}
                                {badge === "knowledge" && <BookOpen size={10} />}
                                {t(`templates.tools.${badge}`)}
                            </span>
                        ))}
                    </div>
                )}
            </button>
        );
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-4xl max-h-[90vh] mx-4 bg-white dark:bg-[#12122a] rounded-xl shadow-2xl dark:shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="border-b border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-white/[0.02] shrink-0">
                <div className="px-6 py-4 flex items-center justify-between">
                    <AnimatedLogo height={28} animate={false} showPoweredBy={false} />
                    <button onClick={handleSkip} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                        {t("navigation.skip")}
                    </button>
                </div>
            </div>

            {/* Progress */}
            <div className="px-6 pt-6 shrink-0">
                <div className="flex items-center gap-2 mb-2">
                    {STEPS.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 flex-1">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 transition-colors ${
                                i < step ? "bg-emerald-500 text-white" :
                                i === step ? "bg-indigo-500 text-white" :
                                "bg-neutral-200 dark:bg-white/10 text-muted-foreground"
                            }`}>
                                {i < step ? <Check size={14} /> : i + 1}
                            </div>
                            <span className={`text-[12px] hidden sm:block ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                {t(s.key)}
                            </span>
                            {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? "bg-emerald-500" : "bg-neutral-200 dark:bg-white/10"}`} />}
                        </div>
                    ))}
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">
                    {t("navigation.stepOf", { current: step + 1, total: STEPS.length })}
                </p>
            </div>

            {/* Content */}
            <div className="px-6 py-6 overflow-y-auto flex-1">

                {/* Step 0: Templates */}
                {step === 0 && (
                    <div>
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("templates.chooseTemplate")}</h2>
                        <p className="text-muted-foreground text-sm mb-6">{t("subtitle")}</p>

                        {verticalTemplates.length > 0 && (
                            <>
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                                    {t("templates.forYourIndustry")}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                                    {verticalTemplates.map((tmpl, i) => renderTemplateCard(tmpl, i, true))}
                                </div>
                            </>
                        )}

                        {builtinTemplates.length > 0 && (
                            <>
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                                    {t("templates.generic")}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {builtinTemplates.map((tmpl, i) => renderTemplateCard(tmpl, i, false))}
                                </div>
                            </>
                        )}

                        <button
                            onClick={() => router.push("/admin/agent")}
                            className="mt-6 text-[13px] text-muted-foreground hover:text-indigo-500 transition-colors"
                        >
                            {t("templates.startFromScratch")} →
                        </button>
                    </div>
                )}

                {/* Step 1: Customize */}
                {step === 1 && selectedTemplate && (
                    <div>
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("step2Title")}</h2>
                        <p className="text-muted-foreground text-sm mb-8">{t("templates.customizeAfter")}</p>
                        <div className="max-w-lg space-y-5">
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("customize.agentName")}</label>
                                <input
                                    type="text" value={agentName} onChange={e => setAgentName(e.target.value)}
                                    className="w-full py-2.5 px-3.5 rounded-xl border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("customize.greeting")}</label>
                                <textarea
                                    value={greeting} onChange={e => setGreeting(e.target.value)} rows={3}
                                    className="w-full py-2.5 px-3.5 rounded-xl border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none focus:border-indigo-500 resize-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-2 font-medium">{t("customize.tone")}</label>
                                <div className="flex gap-3">
                                    {["amigable", "profesional", "casual"].map(t2 => (
                                        <button
                                            key={t2}
                                            onClick={() => setTone(t2)}
                                            className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                                                tone === t2
                                                    ? "border-indigo-500 bg-indigo-500/10 text-indigo-500"
                                                    : "border-neutral-200 dark:border-white/10 text-muted-foreground hover:border-indigo-500/30"
                                            }`}
                                        >
                                            {t(`customize.tone${t2.charAt(0).toUpperCase() + t2.slice(1)}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-2 font-medium">{t("customize.hours")}</label>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setIs247(true)}
                                        className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                                            is247 ? "border-indigo-500 bg-indigo-500/10 text-indigo-500" : "border-neutral-200 dark:border-white/10 text-muted-foreground"
                                        }`}
                                    >
                                        <Clock size={14} className="inline mr-1.5" />{t("customize.hours247")}
                                    </button>
                                    <button
                                        onClick={() => setIs247(false)}
                                        className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                                            !is247 ? "border-indigo-500 bg-indigo-500/10 text-indigo-500" : "border-neutral-200 dark:border-white/10 text-muted-foreground"
                                        }`}
                                    >
                                        {t("customize.hoursCustom")}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 2: Channels */}
                {step === 2 && (
                    <div>
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("channels.title")}</h2>
                        <p className="text-muted-foreground text-sm mb-8">{t("channels.subtitle")}</p>
                        <div className="space-y-3 max-w-lg">
                            {CHANNELS.map(ch => (
                                <button
                                    key={ch.id}
                                    onClick={() => toggleChannel(ch.id)}
                                    className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                                        selectedChannels.includes(ch.id)
                                            ? "border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10"
                                            : "border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04]"
                                    }`}
                                >
                                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-semibold" style={{ background: ch.color }}>
                                        {ch.id[0].toUpperCase()}
                                    </div>
                                    <span className="text-sm text-foreground flex-1">{t(`channels.${ch.key}`)}</span>
                                    {selectedChannels.includes(ch.id) && <Check size={18} className="text-indigo-500" />}
                                </button>
                            ))}
                        </div>

                        <div className="mt-8 max-w-lg">
                            <p className="text-[13px] text-foreground font-semibold mb-1">{t("channels.capabilitiesTitle")}</p>
                            <p className="text-[12px] text-muted-foreground mb-4">{t("channels.capabilitiesSubtitle")}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {CAPABILITIES.map(cap => {
                                    const Icon = cap.icon;
                                    const isEnabled = enabledCapabilities.includes(cap.id);
                                    return (
                                        <button
                                            key={cap.id}
                                            onClick={() => toggleCapability(cap.id)}
                                            className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all ${
                                                isEnabled
                                                    ? "border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10"
                                                    : "border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/30"
                                            }`}
                                        >
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                                                isEnabled ? "bg-indigo-500/15 text-indigo-500" : "bg-neutral-100 dark:bg-white/10 text-muted-foreground"
                                            }`}>
                                                <Icon size={18} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-foreground">{t(`channels.cap_${cap.id}`)}</p>
                                                <p className="text-[11px] text-muted-foreground leading-snug">{t(`channels.cap_${cap.id}_desc`)}</p>
                                            </div>
                                            {isEnabled && <Check size={16} className="text-indigo-500 shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="border-t border-neutral-200 dark:border-white/[0.08] bg-neutral-50 dark:bg-white/[0.02] shrink-0">
                <div className="px-6 py-4 flex items-center justify-between">
                    <button
                        onClick={() => setStep(Math.max(0, step - 1))}
                        disabled={step === 0}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    >
                        <ChevronLeft size={16} /> {t("navigation.previous")}
                    </button>

                    {step < 2 ? (
                        <button
                            onClick={() => setStep(step + 1)}
                            disabled={step === 0 && !selectedTemplate}
                            className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 transition-colors"
                        >
                            {t("navigation.next")} <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button
                            onClick={handleFinish}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 transition-colors"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                            {t("navigation.finish")}
                        </button>
                    )}
                </div>
            </div>
            </div>
        </div>
    );
}
