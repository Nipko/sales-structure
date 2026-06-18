"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
    Target, Headphones, Calendar, ShoppingCart, Building, UtensilsCrossed,
    ChevronRight, ChevronLeft, Check, Sparkles, MessageSquare, Loader2,
    Zap, Clock, Plane, MapPin, Car, Wrench, Heart, BookOpen, GraduationCap,
    Scale, Cpu, Briefcase, Home, Globe, Stethoscope, PawPrint, Plug, Compass, Plus,
} from "lucide-react";
import AnimatedLogo from "@/components/AnimatedLogo";
import WhatsAppConnectPanel from "../channels/whatsapp/WhatsAppConnectPanel";
import SecondaryChannels from "./_components/SecondaryChannels";
import AgentTestChat from "./_components/AgentTestChat";
import ToolsTour from "./_components/ToolsTour";

const ICON_MAP: Record<string, any> = {
    target: Target, headphones: Headphones, calendar: Calendar,
    "shopping-cart": ShoppingCart, building: Building, utensils: UtensilsCrossed,
    plane: Plane, "map-pin": MapPin, car: Car, wrench: Wrench,
    heart: Heart, "book-open": BookOpen, "graduation-cap": GraduationCap,
    scale: Scale, cpu: Cpu, briefcase: Briefcase, home: Home,
    globe: Globe, sparkles: Sparkles, stethoscope: Stethoscope,
    "paw-print": PawPrint,
};

function getToolBadges(tmpl: any): string[] {
    const cfg = tmpl.config || tmpl.config_json || {};
    const badges: string[] = [];
    if (cfg.tools?.appointments?.enabled) badges.push("appointments");
    if (cfg.rag?.enabled) badges.push("knowledge");
    return badges;
}

// Días del horario comercial — claves alineadas con settings.businessHours (monday..sunday).
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

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
    const [hOpen, setHOpen] = useState("08:00");
    const [hClose, setHClose] = useState("18:00");
    const [hDays, setHDays] = useState<Record<string, boolean>>({
        monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false,
    });
    const [faqs, setFaqs] = useState<{ q: string; a: string }[]>([{ q: "", a: "" }]);
    const [channelConnected, setChannelConnected] = useState(false);
    const autoAdvancedRef = useRef(false);

    // Construye el objeto businessHours canónico (settings.businessHours) según el toggle.
    const buildBusinessHours = () => {
        if (is247) {
            const allDay = { enabled: true, open: "00:00", close: "23:59" };
            return { is247: true, timezone: "America/Bogota", schedule: Object.fromEntries(WEEKDAYS.map(d => [d, { ...allDay }])) };
        }
        return {
            is247: false,
            timezone: "America/Bogota",
            schedule: Object.fromEntries(WEEKDAYS.map(d => [d, { enabled: !!hDays[d], open: hOpen, close: hClose }])),
        };
    };

    useEffect(() => {
        if (!tenantId) return;
        api.getPersonaTemplates(tenantId).then(res => {
            const tmpls = res.success ? (res.data || []) : [];
            setTemplates(tmpls);
            // Restaurar progreso guardado (persistencia ante refresh a mitad del wizard).
            try {
                const raw = localStorage.getItem(`parallly:setupwizard:${tenantId}`);
                if (raw) {
                    const s = JSON.parse(raw);
                    const tm = s.templateId ? tmpls.find((x: any) => x.id === s.templateId) : null;
                    if (tm) setSelectedTemplate(tm);
                    if (typeof s.agentName === "string") setAgentName(s.agentName);
                    if (typeof s.greeting === "string") setGreeting(s.greeting);
                    if (typeof s.tone === "string") setTone(s.tone);
                    if (typeof s.is247 === "boolean") setIs247(s.is247);
                    if (typeof s.hOpen === "string") setHOpen(s.hOpen);
                    if (typeof s.hClose === "string") setHClose(s.hClose);
                    if (s.hDays && typeof s.hDays === "object" && !Array.isArray(s.hDays)) setHDays(s.hDays);
                    if (Array.isArray(s.faqs) && s.faqs.length) setFaqs(s.faqs);
                    // Solo restaurar paso >0 si hay template (los pasos 1+ lo requieren).
                    if (typeof s.step === "number" && (s.step === 0 || tm)) setStep(Math.min(4, Math.max(0, s.step)));
                }
            } catch { /* estado corrupto → empezar limpio */ }
            setLoading(false);
        });
    }, [tenantId]);

    // Persistir el progreso del wizard para sobrevivir a un refresh.
    useEffect(() => {
        if (!tenantId || loading) return;
        try {
            localStorage.setItem(`parallly:setupwizard:${tenantId}`, JSON.stringify({
                step, templateId: selectedTemplate?.id || null,
                agentName, greeting, tone, is247, hOpen, hClose, hDays, faqs,
            }));
        } catch { /* storage no disponible */ }
    }, [tenantId, loading, step, selectedTemplate, agentName, greeting, tone, is247, hOpen, hClose, hDays, faqs]);

    // While on the "Conéctalo" step, poll for any connected channel (covers
    // WhatsApp AND channels connected via their own OAuth pages).
    useEffect(() => {
        if (step !== 3 || channelConnected || !tenantId) return;
        let active = true;
        const check = async () => {
            try {
                const res: any = await api.getSetupStatus(tenantId);
                if (active && res?.success && res?.data?.hasAnyChannel) setChannelConnected(true);
            } catch { /* ignore */ }
        };
        check();
        const iv = setInterval(check, 4000);
        return () => { active = false; clearInterval(iv); };
    }, [step, channelConnected, tenantId]);

    // Once a channel connects (via the WhatsApp panel OR a secondary channel page
    // opened in another tab), smoothly advance to the "Descúbrelo" tour so the
    // guided flow continues instead of leaving the user stranded.
    useEffect(() => {
        if (channelConnected && step === 3 && !autoAdvancedRef.current) {
            autoAdvancedRef.current = true;
            const tm = setTimeout(() => setStep(4), 1400);
            return () => clearTimeout(tm);
        }
    }, [channelConnected, step]);

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
                customizations: { agentName, greeting, tone, is247, businessHours: buildBusinessHours() },
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
        // Sembrar FAQs como conocimiento (Fase 2.4) — fire-and-forget, no bloquea el cierre.
        const filledFaqs = faqs.filter(f => f.q.trim() && f.a.trim());
        if (filledFaqs.length > 0) {
            void Promise.allSettled(
                filledFaqs.map(f => api.createKnowledgeDoc(f.q.trim(), `P: ${f.q.trim()}\nR: ${f.a.trim()}`, "faq")),
            );
        }
        // Progreso del wizard ya consumido → limpiar el estado persistido.
        try { localStorage.removeItem(`parallly:setupwizard:${tenantId}`); } catch { /* noop */ }
        // Disparar el tour guiado al aterrizar en /admin (solo al COMPLETAR, no al saltar).
        try { localStorage.setItem("parallly:tour:pending", "true"); } catch { /* noop */ }
        window.location.href = "/admin";
    };

    const handleSkip = async () => {
        if (tenantId) {
            try { localStorage.removeItem(`parallly:setupwizard:${tenantId}`); } catch { /* noop */ }
        }
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
        { key: "testTitle", icon: MessageSquare },
        { key: "connectTitle", icon: Plug },
        { key: "discoverTitle", icon: Compass },
    ];
    const LAST_STEP = STEPS.length - 1;

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
                                <p className="text-[11px] text-muted-foreground mt-1.5">{t("customize.agentNameHint")}</p>
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

                                {/* Mini-form de horarios (Fase 2.2) — solo cuando NO es 24/7 */}
                                {!is247 && (
                                    <div className="mt-3 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] p-4 space-y-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1">
                                                <label className="block text-[12px] text-muted-foreground mb-1">{t("customize.openTime")}</label>
                                                <input
                                                    type="time" value={hOpen} onChange={e => setHOpen(e.target.value)}
                                                    className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-white/5 text-foreground text-sm outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <label className="block text-[12px] text-muted-foreground mb-1">{t("customize.closeTime")}</label>
                                                <input
                                                    type="time" value={hClose} onChange={e => setHClose(e.target.value)}
                                                    className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/10 bg-white dark:bg-white/5 text-foreground text-sm outline-none focus:border-indigo-500"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-[12px] text-muted-foreground mb-1.5">{t("customize.activeDays")}</label>
                                            <div className="flex gap-1.5 flex-wrap">
                                                {WEEKDAYS.map(d => (
                                                    <button
                                                        key={d} type="button"
                                                        onClick={() => setHDays(prev => ({ ...prev, [d]: !prev[d] }))}
                                                        className={`min-w-9 h-9 px-2 rounded-lg text-[12px] font-medium transition-colors ${
                                                            hDays[d] ? "bg-indigo-500 text-white" : "bg-white dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-muted-foreground"
                                                        }`}
                                                    >
                                                        {t(`customize.dayAbbr.${d}`)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Mini-FAQ (Fase 2.4) — opcional, siembra conocimiento del agente */}
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">{t("customize.faqTitle")}</label>
                                <p className="text-[11px] text-muted-foreground mb-2.5">{t("customize.faqHint")}</p>
                                <div className="space-y-3">
                                    {faqs.map((f, i) => (
                                        <div key={i} className="space-y-1.5">
                                            <input
                                                type="text" value={f.q}
                                                onChange={e => setFaqs(prev => prev.map((x, j) => j === i ? { ...x, q: e.target.value } : x))}
                                                placeholder={t("customize.faqQuestion")}
                                                className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none focus:border-indigo-500"
                                            />
                                            <textarea
                                                value={f.a} rows={2}
                                                onChange={e => setFaqs(prev => prev.map((x, j) => j === i ? { ...x, a: e.target.value } : x))}
                                                placeholder={t("customize.faqAnswer")}
                                                className="w-full py-2 px-3 rounded-lg border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none focus:border-indigo-500 resize-none"
                                            />
                                        </div>
                                    ))}
                                </div>
                                {faqs.length < 3 && (
                                    <button
                                        type="button"
                                        onClick={() => setFaqs(prev => [...prev, { q: "", a: "" }])}
                                        className="mt-2 text-[12px] text-indigo-500 hover:text-indigo-600 font-medium inline-flex items-center gap-1"
                                    >
                                        <Plus size={13} /> {t("customize.faqAdd")}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 2: Pruébalo (test chat) */}
                {step === 2 && tenantId && (
                    <div className="max-w-2xl mx-auto">
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("test.title")}</h2>
                        <p className="text-muted-foreground text-sm mb-6">{t("test.subtitle")}</p>
                        <AgentTestChat tenantId={tenantId} />
                    </div>
                )}

                {/* Step 3: Conéctalo (connect ≥1 channel) */}
                {step === 3 && tenantId && (
                    <div className="max-w-lg mx-auto">
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("connect.title")}</h2>
                        <p className="text-muted-foreground text-sm mb-5">{t("connect.subtitle")}</p>

                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("connect.recommendedWhatsapp")}</p>
                        <WhatsAppConnectPanel tenantId={tenantId} variant="onboarding" onConnected={() => setChannelConnected(true)} />

                        <div className="mt-7">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("connect.otherChannels")}</p>
                            <SecondaryChannels />
                        </div>
                    </div>
                )}

                {/* Step 4: Descúbrelo (tools tour) */}
                {step === 4 && (
                    <div className="max-w-2xl mx-auto">
                        <h2 className="text-2xl font-semibold text-foreground mb-1">{t("discover.title")}</h2>
                        <p className="text-muted-foreground text-sm mb-6">{t("discover.subtitle")}</p>
                        <ToolsTour />
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

                    {step < LAST_STEP ? (
                        step === 3 ? (
                            <button
                                onClick={() => setStep(step + 1)}
                                className={`inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                                    channelConnected
                                        ? "bg-indigo-500 text-white hover:bg-indigo-600"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {channelConnected ? t("connect.continue") : t("connect.connectLater")} <ChevronRight size={16} />
                            </button>
                        ) : (
                            <button
                                onClick={() => setStep(step + 1)}
                                disabled={step === 0 && !selectedTemplate}
                                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 transition-colors"
                            >
                                {t("navigation.next")} <ChevronRight size={16} />
                            </button>
                        )
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
