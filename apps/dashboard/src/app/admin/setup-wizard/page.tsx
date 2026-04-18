"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
    Target, Headphones, Calendar, ShoppingCart, Building, UtensilsCrossed,
    ChevronRight, ChevronLeft, Check, Sparkles, MessageSquare, Loader2,
    Zap, Clock, Users,
} from "lucide-react";
import AnimatedLogo from "@/components/AnimatedLogo";

const GOALS = ["respond247", "qualifySales", "scheduleAppointments", "handleOrders"];

const ICON_MAP: Record<string, any> = {
    target: Target, headphones: Headphones, calendar: Calendar,
    "shopping-cart": ShoppingCart, building: Building, utensils: UtensilsCrossed,
};

const CHANNELS = [
    { id: "whatsapp", key: "whatsapp", color: "#25D366" },
    { id: "instagram", key: "instagram", color: "#E4405F" },
    { id: "messenger", key: "messenger", color: "#0084FF" },
    { id: "telegram", key: "telegram", color: "#0088CC" },
];

const INTEGRATIONS = [
    { name: "Google Calendar", icon: "📅" },
    { name: "Shopify", icon: "🛒" },
    { name: "WooCommerce", icon: "🏪" },
    { name: "Google Sheets", icon: "📊" },
    { name: "Zapier", icon: "⚡" },
];

export default function SetupWizardPage() {
    const t = useTranslations("setupWizard");
    const { user } = useAuth();
    const router = useRouter();
    const tenantId = user?.tenantId;

    const [step, setStep] = useState(0);
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form state
    const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
    const [agentName, setAgentName] = useState("");
    const [greeting, setGreeting] = useState("");
    const [tone, setTone] = useState("amigable");
    const [is247, setIs247] = useState(true);
    const [selectedChannels, setSelectedChannels] = useState<string[]>(["whatsapp"]);

    useEffect(() => {
        api.getPersonaTemplates().then(res => {
            if (res.success) setTemplates(res.data || []);
            setLoading(false);
        });
    }, []);

    const handleSelectTemplate = (tmpl: any) => {
        setSelectedTemplate(tmpl);
        setAgentName(tmpl.config.persona.name);
        setGreeting(tmpl.config.persona.greeting);
        setTone(tmpl.config.persona.personality.tone);
    };

    const toggleChannel = (id: string) => {
        setSelectedChannels(prev =>
            prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
        );
    };

    const handleFinish = async () => {
        if (!tenantId || !selectedTemplate) return;
        setSaving(true);
        await api.applySetupTemplate(tenantId, {
            templateId: selectedTemplate.id,
            customizations: { agentName, greeting, tone },
            selectedChannels,
        });
        setSaving(false);
        router.push("/admin");
    };

    const handleSkip = () => router.push("/admin");

    const STEPS = [
        { key: "step1Title", icon: Target },
        { key: "step2Title", icon: Sparkles },
        { key: "step3Title", icon: Zap },
        { key: "step4Title", icon: MessageSquare },
    ];

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-[#0a0a14]">
                <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
        );
    }

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

                {/* Step 0: Goal */}
                {step === 0 && (
                    <div>
                        <h2 className="text-2xl font-semibold text-foreground mb-2">{t("step1Subtitle")}</h2>
                        <p className="text-muted-foreground text-sm mb-8">{t("subtitle")}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {GOALS.map(goal => {
                                const selected = selectedGoals.includes(goal);
                                return (
                                    <button
                                        key={goal}
                                        onClick={() => setSelectedGoals(prev => selected ? prev.filter(g => g !== goal) : [...prev, goal])}
                                        className={`p-4 rounded-xl border text-left transition-all flex items-center gap-3 ${
                                            selected
                                                ? "border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10 ring-1 ring-indigo-500/30"
                                                : "border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/30"
                                        }`}
                                    >
                                        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${selected ? "bg-indigo-500 text-white" : "border-2 border-neutral-300 dark:border-white/20"}`}>
                                            {selected && <Check size={12} />}
                                        </div>
                                        <p className="text-sm font-medium text-foreground">{t(`goal_${goal}`)}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Step 1: Templates */}
                {step === 1 && (
                    <div>
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("templates.chooseTemplate")}</h2>
                        <p className="text-muted-foreground text-sm mb-8">{t("templates.customizeAfter")}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {templates.map((tmpl: any, i: number) => {
                                const Icon = ICON_MAP[tmpl.icon] || Target;
                                const isSelected = selectedTemplate?.id === tmpl.id;
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
                                        {i < 2 && (
                                            <span className="absolute -top-2.5 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500 text-white">
                                                {t("templates.popular")}
                                            </span>
                                        )}
                                        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 mb-3">
                                            <Icon size={20} />
                                        </div>
                                        <p className="text-sm font-semibold text-foreground mb-1 truncate">{t(tmpl.nameKey)}</p>
                                        <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">{t(tmpl.descKey)}</p>
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => router.push("/admin/agent")}
                            className="mt-6 text-[13px] text-muted-foreground hover:text-indigo-500 transition-colors"
                        >
                            {t("templates.startFromScratch")} →
                        </button>
                    </div>
                )}

                {/* Step 2: Customize */}
                {step === 2 && selectedTemplate && (
                    <div>
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("step3Title")}</h2>
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

                {/* Step 3: Channels */}
                {step === 3 && (
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

                        {/* Integrations coming soon */}
                        <div className="mt-8 max-w-lg">
                            <p className="text-[13px] text-muted-foreground font-medium mb-3">{t("channels.integrations")}</p>
                            <div className="flex flex-wrap gap-2">
                                {INTEGRATIONS.map(int => (
                                    <div key={int.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] text-[12px] text-muted-foreground">
                                        <span>{int.icon}</span> {int.name}
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium ml-1">
                                            {t("channels.comingSoon")}
                                        </span>
                                    </div>
                                ))}
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

                    {step < 3 ? (
                        <button
                            onClick={() => setStep(step + 1)}
                            disabled={(step === 0 && selectedGoals.length === 0) || (step === 1 && !selectedTemplate)}
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
            </div>{/* end modal card */}
        </div>
    );
}
