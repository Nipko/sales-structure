"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Building2, Globe, ChevronLeft, ChevronRight,
    AlertCircle, Instagram, Facebook, Linkedin,
    Phone, Mail, Info,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import AnimatedLogo from "@/components/AnimatedLogo";
import MpCardForm from "@/components/billing/MpCardForm";

const STEP_KEYS = ["step1", "step2", "step3", "step4", "step5"];

const PLAN_SLUGS = ["starter", "pro", "enterprise"] as const;
type PlanSlug = typeof PLAN_SLUGS[number];

const INDUSTRY_KEYS = [
    "turismo", "education", "salud", "retail", "technology",
    "servicios_profesionales", "restaurantes", "inmobiliaria",
    "automotriz", "finanzas", "moda_belleza", "otro",
];

const ORG_SIZE_KEYS = ["1-10", "11-20", "21-50", "51-200", "201-1000", "1000+"];

const AUDIENCE_KEYS = ["b2c", "b2b", "government", "other"];

const GOAL_KEYS = [
    "faq", "appointments", "sales", "support",
    "promotions", "lead_qualification", "response_time", "other",
];

const REFERRAL_KEYS = [
    "google", "social_media", "referral", "ai_chat",
    "youtube", "blog", "event", "other",
];

const SUB_TYPES: Record<string, Array<{key: string; label: string}>> = {
    salud: [
        { key: 'dental', label: 'Odontología' },
        { key: 'medica_general', label: 'Medicina general' },
        { key: 'estetica', label: 'Estética y dermatología' },
        { key: 'psicologia', label: 'Psicología y terapia' },
        { key: 'farmacia', label: 'Farmacia' },
    ],
    education: [
        { key: 'idiomas', label: 'Escuela de idiomas' },
        { key: 'universitaria', label: 'Universidad / Instituto' },
        { key: 'online', label: 'Cursos online' },
        { key: 'capacitacion', label: 'Capacitación empresarial' },
    ],
    turismo: [
        { key: 'agencia_viajes', label: 'Agencia de viajes' },
        { key: 'hotel', label: 'Hotel / Hostal' },
        { key: 'tours', label: 'Tours y actividades' },
    ],
    restaurantes: [
        { key: 'casual_dining', label: 'Restaurante casual' },
        { key: 'comida_rapida', label: 'Comida rápida' },
        { key: 'cafeteria', label: 'Cafetería' },
        { key: 'dark_kitchen', label: 'Dark kitchen / Delivery' },
    ],
    inmobiliaria: [
        { key: 'venta', label: 'Venta de inmuebles' },
        { key: 'arriendo', label: 'Arriendo' },
        { key: 'comercial', label: 'Inmuebles comerciales' },
        { key: 'construccion', label: 'Construcción y proyectos' },
    ],
    automotriz: [
        { key: 'concesionario', label: 'Concesionario' },
        { key: 'taller', label: 'Taller mecánico' },
        { key: 'repuestos', label: 'Repuestos y accesorios' },
        { key: 'alquiler', label: 'Alquiler de vehículos' },
    ],
    moda_belleza: [
        { key: 'salon_belleza', label: 'Salón de belleza' },
        { key: 'barberia', label: 'Barbería' },
        { key: 'spa', label: 'Spa y bienestar' },
        { key: 'boutique', label: 'Boutique de moda' },
    ],
    finanzas: [
        { key: 'seguros', label: 'Seguros' },
        { key: 'asesoria', label: 'Asesoría financiera' },
        { key: 'fintech', label: 'Fintech' },
        { key: 'creditos', label: 'Créditos y préstamos' },
    ],
    servicios_profesionales: [
        { key: 'abogados', label: 'Abogados' },
        { key: 'contadores', label: 'Contadores' },
        { key: 'arquitectos', label: 'Arquitectos' },
        { key: 'consultores', label: 'Consultores' },
    ],
    retail: [
        { key: 'moda', label: 'Moda y ropa' },
        { key: 'electronica', label: 'Electrónica' },
        { key: 'hogar', label: 'Hogar y decoración' },
        { key: 'marketplace', label: 'Marketplace / E-commerce' },
    ],
    technology: [
        { key: 'saas', label: 'SaaS' },
        { key: 'consultoria_ti', label: 'Consultoría TI' },
        { key: 'desarrollo', label: 'Desarrollo de software' },
        { key: 'hardware', label: 'Hardware y redes' },
    ],
};

const VERTICAL_GOALS: Record<string, Array<{key: string; label: string; icon: string}>> = {
    salud: [
        { key: 'appointments', label: 'Agendar citas médicas', icon: '📅' },
        { key: 'faq', label: 'Responder preguntas de pacientes', icon: '❓' },
        { key: 'support', label: 'Atención y seguimiento post-consulta', icon: '💊' },
        { key: 'reminders', label: 'Recordatorios de citas y tratamientos', icon: '🔔' },
    ],
    moda_belleza: [
        { key: 'appointments', label: 'Reservar citas de servicios', icon: '💇' },
        { key: 'faq', label: 'Informar sobre servicios y precios', icon: '💅' },
        { key: 'promotions', label: 'Enviar promociones y ofertas', icon: '🎁' },
        { key: 'sales', label: 'Recomendar y vender productos', icon: '🛍️' },
    ],
    inmobiliaria: [
        { key: 'lead_qualification', label: 'Calificar interesados (presupuesto, zona)', icon: '🏠' },
        { key: 'appointments', label: 'Agendar visitas a propiedades', icon: '📍' },
        { key: 'faq', label: 'Informar sobre portafolio y financiación', icon: '📋' },
        { key: 'sales', label: 'Seguimiento de prospectos', icon: '📞' },
    ],
    restaurantes: [
        { key: 'appointments', label: 'Gestionar reservas de mesa', icon: '🍽️' },
        { key: 'faq', label: 'Mostrar menú y recomendaciones', icon: '📖' },
        { key: 'sales', label: 'Procesar pedidos a domicilio', icon: '🛵' },
        { key: 'promotions', label: 'Enviar ofertas y eventos especiales', icon: '🎉' },
    ],
    automotriz: [
        { key: 'lead_qualification', label: 'Calificar prospectos de vehículos', icon: '🚗' },
        { key: 'appointments', label: 'Agendar pruebas de manejo', icon: '🏁' },
        { key: 'faq', label: 'Información de financiamiento y garantías', icon: '💰' },
        { key: 'sales', label: 'Mostrar inventario de vehículos', icon: '📦' },
    ],
    turismo: [
        { key: 'sales', label: 'Cotizar paquetes de viaje', icon: '✈️' },
        { key: 'appointments', label: 'Gestionar reservas', icon: '🏨' },
        { key: 'faq', label: 'Información de destinos y documentos', icon: '🗺️' },
        { key: 'support', label: 'Soporte al viajero', icon: '🆘' },
    ],
    education: [
        { key: 'faq', label: 'Informar sobre programas y requisitos', icon: '🎓' },
        { key: 'appointments', label: 'Agendar clases de prueba', icon: '📚' },
        { key: 'lead_qualification', label: 'Proceso de inscripción', icon: '📝' },
        { key: 'support', label: 'Soporte académico', icon: '👩‍🏫' },
    ],
    finanzas: [
        { key: 'lead_qualification', label: 'Pre-calificar solicitudes', icon: '📊' },
        { key: 'faq', label: 'Informar sobre productos financieros', icon: '💳' },
        { key: 'appointments', label: 'Agendar asesorías', icon: '📅' },
        { key: 'support', label: 'Soporte y seguimiento', icon: '📞' },
    ],
    servicios_profesionales: [
        { key: 'appointments', label: 'Agendar consultas', icon: '📅' },
        { key: 'lead_qualification', label: 'Evaluar tipo de caso', icon: '⚖️' },
        { key: 'faq', label: 'Información de servicios y honorarios', icon: '📋' },
        { key: 'support', label: 'Seguimiento de casos', icon: '📂' },
    ],
};

const VERTICAL_AGENT_NAMES: Record<string, string> = {
    salud: 'Sofía',
    moda_belleza: 'Luna',
    inmobiliaria: 'Carlos',
    restaurantes: 'Luca',
    automotriz: 'Marco',
    turismo: 'Maya',
    education: 'Pablo',
    finanzas: 'Roberto',
    servicios_profesionales: 'Elena',
};

const VERTICAL_AUDIENCES: Record<string, Array<{key: string; label: string}>> = {
    salud: [
        { key: 'b2c', label: 'Pacientes particulares' },
        { key: 'b2b', label: 'Empresas y convenios' },
        { key: 'insurance', label: 'Pacientes con seguro médico' },
    ],
    moda_belleza: [
        { key: 'b2c', label: 'Clientes individuales' },
        { key: 'b2b', label: 'Eventos y grupos' },
        { key: 'vip', label: 'Clientes VIP y membresías' },
    ],
    inmobiliaria: [
        { key: 'buyers', label: 'Compradores' },
        { key: 'renters', label: 'Arrendatarios' },
        { key: 'investors', label: 'Inversionistas' },
    ],
    restaurantes: [
        { key: 'b2c', label: 'Comensales individuales' },
        { key: 'events', label: 'Eventos corporativos y privados' },
        { key: 'delivery', label: 'Clientes de delivery' },
    ],
    automotriz: [
        { key: 'new_buyers', label: 'Compradores de vehículos nuevos' },
        { key: 'used_buyers', label: 'Compradores de vehículos usados' },
        { key: 'service', label: 'Clientes de taller y servicio' },
    ],
    turismo: [
        { key: 'leisure', label: 'Viajeros de ocio' },
        { key: 'corporate', label: 'Viajes corporativos' },
        { key: 'groups', label: 'Grupos y familias' },
    ],
    education: [
        { key: 'students', label: 'Estudiantes individuales' },
        { key: 'parents', label: 'Padres de familia' },
        { key: 'corporate', label: 'Capacitación empresarial' },
    ],
    finanzas: [
        { key: 'individuals', label: 'Personas naturales' },
        { key: 'businesses', label: 'Empresas y PYMES' },
        { key: 'investors', label: 'Inversionistas' },
    ],
    servicios_profesionales: [
        { key: 'individuals', label: 'Personas naturales' },
        { key: 'businesses', label: 'Empresas' },
        { key: 'legal', label: 'Casos legales/contables' },
    ],
};

const VERTICAL_CUSTOMER_NOUN: Record<string, string> = {
    salud: 'pacientes',
    moda_belleza: 'clientes',
    inmobiliaria: 'prospectos',
    restaurantes: 'comensales',
    automotriz: 'compradores',
    turismo: 'viajeros',
    education: 'estudiantes',
    finanzas: 'clientes',
    servicios_profesionales: 'clientes',
};

// TikTok icon (lucide doesn't have one)
function TikTokIcon({ className }: { className?: string }) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
        </svg>
    );
}

const inputClasses = "w-full py-3 px-3.5 rounded-xl border border-neutral-300 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-foreground text-sm outline-none transition-colors focus:border-indigo-500 dark:focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20";
const inputWithIconClasses = cn(inputClasses, "pl-11");
const selectClasses = cn(inputClasses, "appearance-none cursor-pointer");

export default function OnboardingPage() {
    const t = useTranslations('onboarding');
    const [step, setStep] = useState(0);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    // Step 1
    const [companyName, setCompanyName] = useState("");
    const [website, setWebsite] = useState("");
    const [phone, setPhone] = useState("");
    const [businessEmail, setBusinessEmail] = useState("");
    const [about, setAbout] = useState("");
    const [instagram, setInstagram] = useState("");
    const [facebook, setFacebook] = useState("");
    const [linkedin, setLinkedin] = useState("");
    const [tiktok, setTiktok] = useState("");
    const [industry, setIndustry] = useState("");
    const [subType, setSubType] = useState("");
    const [orgSize, setOrgSize] = useState("");
    const [timezone, setTimezone] = useState("America/Bogota");

    // Step 2
    const [audiences, setAudiences] = useState<string[]>([]);
    const [audienceOther, setAudienceOther] = useState("");

    // Step 3
    const [goals, setGoals] = useState<string[]>([]);
    const [goalOther, setGoalOther] = useState("");

    // Step 4
    const [referral, setReferral] = useState("");
    const [referralOther, setReferralOther] = useState("");

    // Step 5 — plan picker + card for paid tiers
    const [planSlug, setPlanSlug] = useState<PlanSlug>("starter");
    const [cardTokenId, setCardTokenId] = useState<string | null>(null);

    // Protected
    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) router.push("/login");
    }, [router]);

    const toggleCheckbox = (
        list: string[],
        setList: (v: string[]) => void,
        value: string
    ) => {
        setList(
            list.includes(value)
                ? list.filter((v2) => v2 !== value)
                : [...list, value]
        );
    };

    const canProceed = (): boolean => {
        switch (step) {
            case 0:
                return !!companyName.trim() && !!industry && !!orgSize;
            case 1:
                return audiences.length > 0;
            case 2:
                return goals.length > 0;
            case 3:
                return !!referral;
            case 4:
                // Starter is always valid. Pro/Enterprise require a card
                // token (collected via the MP card form below).
                if (planSlug === "starter") return true;
                return !!cardTokenId;
            default:
                return false;
        }
    };

    const handleNext = () => {
        if (!canProceed()) return;
        if (step < 4) {
            setStep(step + 1);
        } else {
            handleSubmit();
        }
    };

    const handleSubmit = async () => {
        setError("");
        setIsSubmitting(true);

        const data = {
            company: {
                name: companyName,
                website: website || undefined,
                phone: phone || undefined,
                email: businessEmail || undefined,
                about: about || undefined,
                socialMedia: {
                    instagram: instagram || undefined,
                    facebook: facebook || undefined,
                    linkedin: linkedin || undefined,
                    tiktok: tiktok || undefined,
                },
                industry,
                subType: subType || undefined,
                orgSize,
                timezone,
            },
            audiences: audiences.includes("other")
                ? [...audiences.filter((a) => a !== "other"), `other:${audienceOther}`]
                : audiences,
            goals: goals.includes("other")
                ? [...goals.filter((g) => g !== "other"), `other:${goalOther}`]
                : goals,
            referral: referral === "other" ? `other:${referralOther}` : referral,
            plan: planSlug,
            cardTokenId: planSlug !== "starter" ? cardTokenId : undefined,
        };

        try {
            const result = await api.completeOnboarding(data);
            if (!result.success) {
                setError(result.error || "Error completing registration");
                setIsSubmitting(false);
                return;
            }

            // Update tokens & user if returned
            if (result.data) {
                const d = result.data as any;
                if (d.accessToken) localStorage.setItem("accessToken", d.accessToken);
                if (d.refreshToken) localStorage.setItem("refreshToken", d.refreshToken);
                if (d.user) localStorage.setItem("user", JSON.stringify(d.user));
            }

            // Full page reload so AuthContext re-reads the new tokens with tenantId
            // router.push would keep the old user state without tenantId
            window.location.href = "/admin";
        } catch {
            setError("Connection error");
        }
        setIsSubmitting(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[520px] relative z-10">
                {/* Logo */}
                <div className="text-center mb-6">
                    <AnimatedLogo height={44} animate showPoweredBy={false} />
                </div>

                {/* Progress bar */}
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                        {STEP_KEYS.map((s, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "text-xs font-medium transition-colors",
                                    i <= step
                                        ? "text-indigo-600 dark:text-indigo-400"
                                        : "text-muted-foreground/50"
                                )}
                            >
                                {t(s)}
                            </div>
                        ))}
                    </div>
                    <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300"
                            style={{ width: `${((step + 1) / STEP_KEYS.length) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Card */}
                <div className="p-8 rounded-xl bg-white dark:bg-white/[0.04] border border-neutral-200 dark:border-white/[0.08] shadow-lg dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] dark:backdrop-blur-xl">
                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {/* Step 1: Company */}
                    {step === 0 && (
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-1">Tu empresa</h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                Tell us about your business
                            </p>

                            {/* Company Name */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    Nombre de la empresa *
                                </label>
                                <div className="relative">
                                    <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="text"
                                        value={companyName}
                                        onChange={(e) => setCompanyName(e.target.value)}
                                        placeholder="My Company LLC"
                                        className={inputWithIconClasses}
                                    />
                                </div>
                            </div>

                            {/* Website */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('website')}
                                </label>
                                <div className="relative">
                                    <Globe size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="url"
                                        value={website}
                                        onChange={(e) => setWebsite(e.target.value)}
                                        placeholder="https://..."
                                        className={inputWithIconClasses}
                                    />
                                </div>
                            </div>

                            {/* Business Contact — used by the AI agent when customers ask */}
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div>
                                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                        {t('businessPhone')}
                                    </label>
                                    <div className="relative">
                                        <Phone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="tel"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            placeholder={t('businessPhonePlaceholder')}
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                        {t('businessEmail')}
                                    </label>
                                    <div className="relative">
                                        <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="email"
                                            value={businessEmail}
                                            onChange={(e) => setBusinessEmail(e.target.value)}
                                            placeholder={t('businessEmailPlaceholder')}
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* About — fed into the agent's <turn.business> block */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('about')}
                                </label>
                                <div className="relative">
                                    <Info size={16} className="absolute left-3.5 top-3 text-muted-foreground/50" />
                                    <textarea
                                        value={about}
                                        onChange={(e) => setAbout(e.target.value)}
                                        placeholder={t('aboutPlaceholder')}
                                        rows={3}
                                        className={cn(inputWithIconClasses, "pt-3 pb-3 resize-y min-h-[80px]")}
                                    />
                                </div>
                                <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                                    {t('aboutHint')}
                                </p>
                            </div>

                            {/* Social Media */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-2 font-medium">
                                    Redes sociales
                                </label>
                                <div className="space-y-2.5">
                                    <div className="relative">
                                        <Instagram size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={instagram}
                                            onChange={(e) => setInstagram(e.target.value)}
                                            placeholder="Instagram URL"
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                    <div className="relative">
                                        <Facebook size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={facebook}
                                            onChange={(e) => setFacebook(e.target.value)}
                                            placeholder="Facebook URL"
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                    <div className="relative">
                                        <Linkedin size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={linkedin}
                                            onChange={(e) => setLinkedin(e.target.value)}
                                            placeholder="LinkedIn URL"
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                    <div className="relative">
                                        <TikTokIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={tiktok}
                                            onChange={(e) => setTiktok(e.target.value)}
                                            placeholder="TikTok URL"
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Industry */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('industry')} *
                                </label>
                                <select
                                    value={industry}
                                    onChange={(e) => { setIndustry(e.target.value); setSubType(""); }}
                                    className={cn(selectClasses, "pr-8")}
                                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239898b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                                >
                                    <option value="" disabled>—</option>
                                    {INDUSTRY_KEYS.map((key) => (
                                        <option key={key} value={key} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                            {t(`industries.${key}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Sub-type (conditional) */}
                            {SUB_TYPES[industry] && (
                                <div className="mb-4">
                                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                        Tipo de negocio
                                    </label>
                                    <select
                                        value={subType}
                                        onChange={(e) => setSubType(e.target.value)}
                                        className={cn(selectClasses, "pr-8")}
                                        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239898b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                                    >
                                        <option value="">Seleccionar...</option>
                                        {SUB_TYPES[industry].map((st) => (
                                            <option key={st.key} value={st.key} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                                {st.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Org Size */}
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('companySize')} *
                                </label>
                                <select
                                    value={orgSize}
                                    onChange={(e) => setOrgSize(e.target.value)}
                                    className={cn(selectClasses, "pr-8")}
                                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239898b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                                >
                                    <option value="" disabled>—</option>
                                    {ORG_SIZE_KEYS.map((key) => (
                                        <option key={key} value={key} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                            {t(`orgSizes.${key}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Timezone */}
                            <div className="mt-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('timezone')} *
                                </label>
                                <select
                                    value={timezone}
                                    onChange={(e) => setTimezone(e.target.value)}
                                    className={cn(selectClasses, "pr-8")}
                                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239898b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                                >
                                    <option value="America/Bogota">Bogota, Lima, Quito (UTC-5)</option>
                                    <option value="America/Mexico_City">Mexico City (UTC-6)</option>
                                    <option value="America/Santiago">Santiago (UTC-3)</option>
                                    <option value="America/Argentina/Buenos_Aires">Buenos Aires (UTC-3)</option>
                                    <option value="America/Sao_Paulo">São Paulo (UTC-3)</option>
                                    <option value="America/Caracas">Caracas (UTC-4)</option>
                                    <option value="America/Panama">Panama (UTC-5)</option>
                                    <option value="America/Guayaquil">Guayaquil (UTC-5)</option>
                                    <option value="America/Costa_Rica">Costa Rica (UTC-6)</option>
                                    <option value="America/New_York">New York (UTC-5/4)</option>
                                    <option value="America/Los_Angeles">Los Angeles (UTC-8/7)</option>
                                    <option value="Europe/Madrid">Madrid (UTC+1/2)</option>
                                    <option value="Europe/London">London (UTC+0/1)</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Audience */}
                    {step === 1 && (
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-1">
                                {VERTICAL_AGENT_NAMES[industry]
                                    ? `¿Quién contactará a ${VERTICAL_AGENT_NAMES[industry]}?`
                                    : t('step2')}
                            </h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {t('audienceTitle')}
                            </p>

                            <div className="space-y-3">
                                {(VERTICAL_AUDIENCES[industry] ?? AUDIENCE_KEYS.map(k => ({ key: k, label: t(`audiences.${k}`) }))).map((audience) => (
                                    <label
                                        key={audience.key}
                                        className={cn(
                                            "flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                                            audiences.includes(audience.key)
                                                ? "border-indigo-500 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10"
                                                : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] hover:border-neutral-300 dark:hover:border-white/20"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={audiences.includes(audience.key)}
                                            onChange={() => toggleCheckbox(audiences, setAudiences, audience.key)}
                                            className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                                        />
                                        <span className="text-sm text-foreground">{audience.label}</span>
                                    </label>
                                ))}

                                {audiences.includes("other") && !VERTICAL_AUDIENCES[industry] && (
                                    <input
                                        type="text"
                                        value={audienceOther}
                                        onChange={(e) => setAudienceOther(e.target.value)}
                                        placeholder={t('otherSpecify')}
                                        className={cn(inputClasses, "ml-7")}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Goals */}
                    {step === 2 && (
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-1">
                                {VERTICAL_AGENT_NAMES[industry]
                                    ? `¿Cómo ayudará ${VERTICAL_AGENT_NAMES[industry]} a tus ${VERTICAL_CUSTOMER_NOUN[industry] ?? 'clientes'}?`
                                    : t('goalsTitle')}
                            </h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {VERTICAL_AGENT_NAMES[industry]
                                    ? `Selecciona las funciones que ${VERTICAL_AGENT_NAMES[industry]} realizará automáticamente`
                                    : t('step3')}
                            </p>

                            <div className="space-y-3">
                                {(VERTICAL_GOALS[industry] ?? GOAL_KEYS.map(k => ({ key: k, label: t(`goals.${k}`), icon: '' }))).map((goal) => (
                                    <label
                                        key={goal.key}
                                        className={cn(
                                            "flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                                            goals.includes(goal.key)
                                                ? "border-indigo-500 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10"
                                                : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] hover:border-neutral-300 dark:hover:border-white/20"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={goals.includes(goal.key)}
                                            onChange={() => toggleCheckbox(goals, setGoals, goal.key)}
                                            className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                                        />
                                        <span className="text-sm text-foreground">
                                            {goal.icon && <span className="mr-1.5">{goal.icon}</span>}
                                            {goal.label}
                                        </span>
                                    </label>
                                ))}

                                {goals.includes("other") && !VERTICAL_GOALS[industry] && (
                                    <input
                                        type="text"
                                        value={goalOther}
                                        onChange={(e) => setGoalOther(e.target.value)}
                                        placeholder={t('otherSpecify')}
                                        className={cn(inputClasses, "ml-7")}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 4: Referral */}
                    {step === 3 && (
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-1">{t('referralTitle')}</h2>
                            <p className="text-muted-foreground text-sm mb-6">{t('step4')}</p>

                            <div className="space-y-3">
                                {REFERRAL_KEYS.map((key) => (
                                    <label
                                        key={key}
                                        className={cn(
                                            "flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                                            referral === key
                                                ? "border-indigo-500 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10"
                                                : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] hover:border-neutral-300 dark:hover:border-white/20"
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="referral"
                                            checked={referral === key}
                                            onChange={() => setReferral(key)}
                                            className="w-4 h-4 border-neutral-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                                        />
                                        <span className="text-sm text-foreground">{t(`referrals.${key}`)}</span>
                                    </label>
                                ))}

                                {referral === "other" && (
                                    <input
                                        type="text"
                                        value={referralOther}
                                        onChange={(e) => setReferralOther(e.target.value)}
                                        placeholder={t('otherSpecify')}
                                        className={cn(inputClasses, "ml-7")}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 5: Plan picker */}
                    {step === 4 && (
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-1">{t('planTitle')}</h2>
                            <p className="text-muted-foreground text-sm mb-6">{t('planSubtitle')}</p>

                            <div className="space-y-3">
                                {PLAN_SLUGS.map((slug) => {
                                    const requiresCard = slug !== 'starter';
                                    const active = planSlug === slug;
                                    return (
                                        <label
                                            key={slug}
                                            className={cn(
                                                'flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer',
                                                active
                                                    ? 'border-indigo-500 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10'
                                                    : 'border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03]'
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="plan"
                                                checked={active}
                                                onChange={() => {
                                                    setPlanSlug(slug);
                                                    // Changing plan invalidates any previously tokenised card
                                                    setCardTokenId(null);
                                                }}
                                                className="mt-1 w-4 h-4 border-neutral-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-sm font-semibold text-foreground">{t(`plans.${slug}.name`)}</span>
                                                    <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">{t(`plans.${slug}.price`)}</span>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">{t(`plans.${slug}.desc`)}</p>
                                                {requiresCard && (
                                                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">{t('requiresCardNote')}</p>
                                                )}
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>

                            {/* Inline card form for Pro/Enterprise */}
                            {planSlug !== "starter" && !cardTokenId && (
                                <div className="mt-5 p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900">
                                    <h3 className="text-sm font-semibold mb-3">{t('cardSectionTitle')}</h3>
                                    <MpCardForm
                                        onToken={(token) => setCardTokenId(token)}
                                        submitLabel={t('saveCard')}
                                    />
                                </div>
                            )}

                            {planSlug !== "starter" && cardTokenId && (
                                <div className="mt-5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                                    <span>✓ {t('cardReady')}</span>
                                    <button
                                        type="button"
                                        onClick={() => setCardTokenId(null)}
                                        className="text-xs underline hover:no-underline"
                                    >
                                        {t('changeCard')}
                                    </button>
                                </div>
                            )}

                            <p className="text-xs text-muted-foreground mt-4 text-center">{t('planStarterNote')}</p>
                        </div>
                    )}

                    {/* Navigation */}
                    <div className="flex items-center justify-between mt-8 gap-3">
                        {step > 0 ? (
                            <button
                                type="button"
                                onClick={() => setStep(step - 1)}
                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-white/10 bg-transparent text-sm font-medium text-foreground hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                            >
                                <ChevronLeft size={16} /> Back
                            </button>
                        ) : (
                            <div />
                        )}

                        <button
                            type="button"
                            onClick={handleNext}
                            disabled={!canProceed() || isSubmitting}
                            className={cn(
                                "flex items-center gap-1.5 px-6 py-2.5 rounded-xl border-none text-white text-sm font-semibold transition-all shadow-[0_4px_15px_rgba(108,92,231,0.3)]",
                                !canProceed() || isSubmitting
                                    ? "bg-indigo-400/50 dark:bg-indigo-600/30 cursor-not-allowed"
                                    : "bg-gradient-to-r from-indigo-600 to-indigo-400 cursor-pointer hover:shadow-[0_6px_20px_rgba(108,92,231,0.4)] hover:brightness-110"
                            )}
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Creating...
                                </>
                            ) : step === 4 ? (
                                "Create my account"
                            ) : (
                                <>
                                    Next <ChevronRight size={16} />
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">Powered by <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>
        </div>
    );
}
