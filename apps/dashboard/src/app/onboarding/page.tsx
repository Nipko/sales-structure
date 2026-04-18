"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Building2, Globe, ChevronLeft, ChevronRight,
    AlertCircle, Instagram, Facebook, Linkedin,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import AnimatedLogo from "@/components/AnimatedLogo";

const STEP_KEYS = ["step1", "step2", "step3", "step4"];

const INDUSTRY_KEYS = [
    "turismo", "educación", "salud", "retail", "tecnología",
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
    const [instagram, setInstagram] = useState("");
    const [facebook, setFacebook] = useState("");
    const [linkedin, setLinkedin] = useState("");
    const [tiktok, setTiktok] = useState("");
    const [industry, setIndustry] = useState("");
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
            default:
                return false;
        }
    };

    const handleNext = () => {
        if (!canProceed()) return;
        if (step < 3) {
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
                socialMedia: {
                    instagram: instagram || undefined,
                    facebook: facebook || undefined,
                    linkedin: linkedin || undefined,
                    tiktok: tiktok || undefined,
                },
                industry,
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
        };

        try {
            const result = await api.completeOnboarding(data);
            if (!result.success) {
                setError(result.error || "Error al completar el registro");
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
            setError("Error de conexión con el servidor");
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
                                Cuéntanos sobre tu negocio
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
                                        placeholder="Mi Empresa SAS"
                                        className={inputWithIconClasses}
                                    />
                                </div>
                            </div>

                            {/* Website */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    Website
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
                                    onChange={(e) => setIndustry(e.target.value)}
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
                                    <option value="America/Bogota">Bogotá, Lima, Quito (UTC-5)</option>
                                    <option value="America/Mexico_City">Ciudad de México (UTC-6)</option>
                                    <option value="America/Santiago">Santiago (UTC-3)</option>
                                    <option value="America/Argentina/Buenos_Aires">Buenos Aires (UTC-3)</option>
                                    <option value="America/Sao_Paulo">São Paulo (UTC-3)</option>
                                    <option value="America/Caracas">Caracas (UTC-4)</option>
                                    <option value="America/Panama">Panamá (UTC-5)</option>
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
                            <h2 className="text-xl font-semibold text-foreground mb-1">{t('step2')}</h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {t('audienceTitle')}
                            </p>

                            <div className="space-y-3">
                                {AUDIENCE_KEYS.map((key) => (
                                    <label
                                        key={key}
                                        className={cn(
                                            "flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                                            audiences.includes(key)
                                                ? "border-indigo-500 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10"
                                                : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] hover:border-neutral-300 dark:hover:border-white/20"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={audiences.includes(key)}
                                            onChange={() => toggleCheckbox(audiences, setAudiences, key)}
                                            className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                                        />
                                        <span className="text-sm text-foreground">{t(`audiences.${key}`)}</span>
                                    </label>
                                ))}

                                {audiences.includes("other") && (
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
                            <h2 className="text-xl font-semibold text-foreground mb-1">{t('goalsTitle')}</h2>
                            <p className="text-muted-foreground text-sm mb-6">{t('step3')}</p>

                            <div className="space-y-3">
                                {GOAL_KEYS.map((key) => (
                                    <label
                                        key={key}
                                        className={cn(
                                            "flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                                            goals.includes(key)
                                                ? "border-indigo-500 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10"
                                                : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/[0.03] hover:border-neutral-300 dark:hover:border-white/20"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={goals.includes(key)}
                                            onChange={() => toggleCheckbox(goals, setGoals, key)}
                                            className="w-4 h-4 rounded border-neutral-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                                        />
                                        <span className="text-sm text-foreground">{t(`goals.${key}`)}</span>
                                    </label>
                                ))}

                                {goals.includes("other") && (
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

                    {/* Navigation */}
                    <div className="flex items-center justify-between mt-8 gap-3">
                        {step > 0 ? (
                            <button
                                type="button"
                                onClick={() => setStep(step - 1)}
                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-white/10 bg-transparent text-sm font-medium text-foreground hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                            >
                                <ChevronLeft size={16} /> Anterior
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
                                    Creando...
                                </>
                            ) : step === 3 ? (
                                "Crear mi cuenta"
                            ) : (
                                <>
                                    Siguiente <ChevronRight size={16} />
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
