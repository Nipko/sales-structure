"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    Building2, Globe, ChevronLeft, ChevronRight, ChevronDown,
    AlertCircle, Instagram, Facebook, Linkedin,
    Phone, Mail, Info, Clock, LifeBuoy, X,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { saveBillingCheckoutIntent } from "@/lib/billing-checkout-session";
import {
    clearSignupAttribution,
    readSignupAttribution,
} from "@/lib/signup-attribution";
import {
    SIGNUP_AVAILABILITY,
    getVerticalLabel,
    isCanonicalVerticalCatalog,
    offerableIndustries,
    offerableSubTypes,
    type VerticalCatalogLocale,
    type VerticalDefinitions,
} from "@/lib/vertical-catalog";
import { TIMEZONE_GROUPS, TIMEZONE_VALUES, DEFAULT_TIMEZONE, normalizeTimezone } from "@parallext/shared";
import AnimatedLogo from "@/components/AnimatedLogo";
import LocaleSwitcher from "@/components/LocaleSwitcher";

// Ruta crítica: empresa → audiencia → objetivos → plan. El catálogo del último
// paso viene del backend; ningún slug, precio o requisito de tarjeta vive acá.
const STEP_KEYS = ["step1", "step2", "step3", "step5"];

const SUPPORT_URL = "https://parallly-chat.cloud/support";

// Borrador local. El wizard no hace ninguna llamada al servidor hasta el submit final,
// así que cerrar la pestaña —o que el navegador del celular la descarte en segundo
// plano— borraba todo lo tipeado y devolvía al usuario a un formulario en blanco.
// Se guarda por usuario (un navegador compartido no debe mostrarle los datos de una
// empresa a otra persona), caduca a los 7 días y se borra al completar el alta.
const DRAFT_PREFIX = "parallly:onboarding:draft";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COACH_MARKS_KEY = "parallly:onboarding:coachmarks:business";

function draftKeyForCurrentUser(): string {
    try {
        const raw = localStorage.getItem("user");
        const id = raw ? JSON.parse(raw)?.id : null;
        if (id) return `${DRAFT_PREFIX}:${id}`;
    } catch { /* usuario ilegible → clave anónima */ }
    return `${DRAFT_PREFIX}:anon`;
}

const PRICING_INTENT_KEY = "pricingIntent";
const SALES_EMAIL = "it.executive@parallext.com";
const BILLING_COUNTRIES = [
    "CO", "MX", "AR", "CL", "PE", "BR", "UY", "PY", "BO",
    "EC", "VE", "CR", "PA", "DO", "GT", "US", "CA",
] as const;
type BillingCountry = typeof BILLING_COUNTRIES[number];

type BillingCycle = "monthly" | "annual";
type CheckoutMode = "self_serve" | "contact_sales" | "temporarily_unavailable";

type PricingIntent = {
    plan?: string;
    country?: string;
    cycle?: BillingCycle;
};

type BillingPlan = {
    id?: string;
    slug: string;
    name: string;
    priceUsdCents: number;
    displayPriceCents: number;
    displayPriceAnnualCents?: number | null;
    displayCurrency: string;
    trialDays: number;
    requiresCardForTrial: boolean;
    requiresPaymentMethodAtSignup: boolean;
    providerConfigured: boolean;
    maxAgents: number;
    maxAiMessages: number;
    features: Record<string, unknown>;
    signupAvailable: boolean;
    signupUnavailableReason?: string | null;
    trialAvailable: boolean;
    monthlyAvailable: boolean;
    annualAvailable: boolean;
    checkoutMode: CheckoutMode;
    monthlyUnavailableReason?: string | null;
};

function validPlanSlug(value: string | null): string | undefined {
    const normalized = value?.trim().toLowerCase();
    return normalized && normalized.length <= 80 && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(normalized)
        ? normalized
        : undefined;
}

function validCountry(value: string | null): string | undefined {
    const normalized = value?.trim().toUpperCase();
    return normalized && BILLING_COUNTRIES.includes(normalized as BillingCountry)
        ? normalized
        : undefined;
}

function validCycle(value: string | null): BillingCycle | undefined {
    return value === "monthly" || value === "annual" ? value : undefined;
}

function browserBillingCountry(): string | undefined {
    try {
        for (const language of navigator.languages) {
            const region = new Intl.Locale(language).region?.toUpperCase();
            if (region && BILLING_COUNTRIES.includes(region as BillingCountry)) {
                return region;
            }
        }
    } catch { /* browser without Intl.Locale */ }
    return undefined;
}

function readStoredPricingIntent(): PricingIntent {
    try {
        const raw = sessionStorage.getItem(PRICING_INTENT_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== "object") return {};
        return {
            plan: validPlanSlug(typeof parsed.plan === "string" ? parsed.plan : null),
            country: validCountry(typeof parsed.country === "string" ? parsed.country : null),
            cycle: validCycle(typeof parsed.cycle === "string" ? parsed.cycle : null),
        };
    } catch {
        return {};
    }
}

function isCycleAvailable(plan: BillingPlan, cycle: BillingCycle): boolean {
    // Acquisition has stricter guarantees than an authenticated upgrade. In
    // particular, card-backed trials are blocked until onboarding can persist
    // and safely consume their token end-to-end.
    if (!plan.signupAvailable) return false;
    // A no-card monthly trial can be provisioned locally before a provider plan
    // is synchronized. Card-backed trials and every annual signup remain
    // strictly gated by the provider-backed cycle availability.
    if (
        cycle === "monthly"
        && plan.trialAvailable
        && plan.trialDays > 0
        && !plan.requiresPaymentMethodAtSignup
    ) return true;
    if (plan.checkoutMode !== "self_serve") return false;
    if (cycle === "annual") {
        return plan.annualAvailable && Number.isFinite(plan.displayPriceAnnualCents);
    }
    return plan.monthlyAvailable && Number.isFinite(plan.displayPriceCents);
}

/** The plan a person who did not ask for one should land on: a trial, no card. */
function isNoCardTrial(plan: BillingPlan): boolean {
    return plan.trialAvailable
        && plan.trialDays > 0
        && !plan.requiresPaymentMethodAtSignup
        && isCycleAvailable(plan, "monthly");
}

function formatMoney(amountCents: number, currency: string, locale: string): string {
    try {
        return new Intl.NumberFormat(locale, {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
        }).format(amountCents / 100);
    } catch {
        return `${currency} ${(amountCents / 100).toLocaleString(locale)}`;
    }
}

function billingCountryLabel(country: string, locale: string): string {
    try {
        return new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
    } catch {
        return country;
    }
}

const ORG_SIZE_KEYS = ["1-10", "11-20", "21-50", "51-200", "201-1000", "1000+"];

const AUDIENCE_KEYS = ["b2c", "b2b", "government", "other"];

const GOAL_KEYS = [
    "faq", "appointments", "sales", "support",
    "promotions", "lead_qualification", "response_time", "other",
];

/**
 * Decorative only. The per-industry goal LISTS live in the message catalogue —
 * they used to be duplicated here as a hardcoded Spanish table that no locale
 * ever read, so an added goal had to be written twice and the copy of three
 * languages silently diverged from the fourth.
 */
const GOAL_ICONS: Record<string, string> = {
    appointments: "📅",
    faq: "❓",
    sales: "🛍️",
    support: "🛟",
    promotions: "🎁",
    lead_qualification: "🎯",
    reminders: "🔔",
    response_time: "⚡",
    other: "✨",
};

// ============================================================
// Client-side validation — a mirror of CompleteOnboardingDto
// ============================================================

type FieldPath =
    | "company.name" | "company.website" | "company.phone" | "company.email" | "company.about"
    | "company.industry" | "company.subType" | "company.orgSize" | "company.timezone"
    | "company.socialMedia.instagram" | "company.socialMedia.facebook"
    | "company.socialMedia.linkedin" | "company.socialMedia.tiktok"
    | "couponCode" | "audiences" | "goals" | "plan";

/** Which screen owns each field, so a server error can jump to it. */
const FIELD_STEP: Record<string, number> = {
    company: 0, couponCode: 0, locale: 0,
    audiences: 1,
    goals: 2,
    plan: 3, billingCycle: 3, billingCountry: 3, planSlug: 3,
};

function stepForFieldPath(path: string): number {
    const root = path.split(".")[0];
    return FIELD_STEP[root] ?? 0;
}

// Deliberately permissive, like `class-validator`'s IsEmail for practical input:
// one @, something on each side, a dot in the domain, no spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `parallly.com` → `https://parallly.com`. A URL without a scheme is not a link. */
export function normalizeWebsite(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

interface ValidationValues {
    companyName: string;
    website: string;
    phone: string;
    businessEmail: string;
    about: string;
    instagram: string;
    facebook: string;
    linkedin: string;
    tiktok: string;
    industry: string;
    subType: string;
    orgSize: string;
    timezone: string;
    couponCode: string;
}

/** i18n key suffix under `onboarding.validation`, or null when the field is fine. */
export function validateOnboardingField(field: FieldPath, values: ValidationValues): string | null {
    const tooLong = (value: string, max: number) => value.trim().length > max ? "tooLong" : null;
    switch (field) {
        case "company.name": return tooLong(values.companyName, 200);
        case "company.website": {
            const normalized = normalizeWebsite(values.website);
            if (!normalized) return null;
            if (normalized.length > 500) return "tooLong";
            try { new URL(normalized); } catch { return "invalidUrl"; }
            return null;
        }
        case "company.phone": return tooLong(values.phone, 30);
        case "company.email": {
            const value = values.businessEmail.trim();
            if (!value) return null;
            if (value.length > 254) return "tooLong";
            return EMAIL_PATTERN.test(value) ? null : "invalidEmail";
        }
        case "company.about": return tooLong(values.about, 5000);
        case "company.socialMedia.instagram": return tooLong(values.instagram, 500);
        case "company.socialMedia.facebook": return tooLong(values.facebook, 500);
        case "company.socialMedia.linkedin": return tooLong(values.linkedin, 500);
        case "company.socialMedia.tiktok": return tooLong(values.tiktok, 500);
        case "company.industry": return tooLong(values.industry, 80);
        case "company.subType": return tooLong(values.subType, 80);
        case "company.orgSize": return tooLong(values.orgSize, 50);
        case "company.timezone": return tooLong(values.timezone, 100);
        case "couponCode": return tooLong(values.couponCode, 40);
        default: return null;
    }
}

const STEP_FIELDS: Record<number, FieldPath[]> = {
    0: [
        "company.name", "company.website", "company.phone", "company.email", "company.about",
        "company.socialMedia.instagram", "company.socialMedia.facebook",
        "company.socialMedia.linkedin", "company.socialMedia.tiktok",
        "company.industry", "company.subType", "company.orgSize", "company.timezone",
        "couponCode",
    ],
    1: [],
    2: [],
    3: [],
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
const inputErrorClasses = "border-rose-400 dark:border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/20";
// Fondo sólido oscuro en selects: con color-scheme:dark hace que el popup nativo de
// <option> se renderice oscuro y legible (dark:bg-white/5 translúcido lo dejaba ilegible).
const selectClasses = cn(inputClasses, "appearance-none cursor-pointer dark:bg-neutral-800");
const selectChevron = {
    backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239898b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
} as const;

export default function OnboardingPage() {
    const t = useTranslations('onboarding');
    const locale = useLocale();
    const catalogLocale = locale.split("-")[0] as VerticalCatalogLocale;
    const [step, setStep] = useState(0);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [redirecting, setRedirecting] = useState(false);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const router = useRouter();

    // Cancela el timer del puente si el componente se desmonta antes del redirect.
    useEffect(() => () => { if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current); }, []);

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
    const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
    const [timezoneOpen, setTimezoneOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldPath, string>>>({});
    const [highlightField, setHighlightField] = useState<FieldPath | null>(null);
    // Código promocional del alta. Opcional y no bloqueante: si es inválido el alta
    // se completa igual y el aviso se muestra en la pantalla puente.
    const [couponCode, setCouponCode] = useState("");
    const [couponNotice, setCouponNotice] = useState<{ ok: boolean; months?: number } | null>(null);
    const [verticalDefinitions, setVerticalDefinitions] = useState<VerticalDefinitions>({});
    const [verticalCatalogLoading, setVerticalCatalogLoading] = useState(true);
    const [verticalCatalogError, setVerticalCatalogError] = useState(false);
    const industryKeys = offerableIndustries(verticalDefinitions, SIGNUP_AVAILABILITY);
    // Un alta nueva solo ofrece lo que hoy se puede entregar. El catálogo
    // llega completo a propósito —lo necesitan las pantallas de un tenant que
    // ya está en un perfil cerrado—, así que el recorte es de esta superficie.
    const selectedSubTypes = offerableSubTypes(
        verticalDefinitions[industry] || [],
        SIGNUP_AVAILABILITY,
    );
    const verticalCatalogReady = industryKeys.length > 0;

    // Step 2
    const [audiences, setAudiences] = useState<string[]>([]);
    const [audienceOther, setAudienceOther] = useState("");

    // Step 3
    const [goals, setGoals] = useState<string[]>([]);
    const [goalOther, setGoalOther] = useState("");

    // Step 4 — active billing catalog. The initial selection comes from the
    // landing intent when present and is revalidated after the API responds.
    const [planSlug, setPlanSlug] = useState("");
    const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
    const [billingCountry, setBillingCountry] = useState<string | undefined>();
    const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
    const [planCatalogLoading, setPlanCatalogLoading] = useState(true);
    const [planCatalogError, setPlanCatalogError] = useState(false);
    const [planCatalogCountry, setPlanCatalogCountry] = useState<string | undefined>();
    const [planCatalogReloadKey, setPlanCatalogReloadKey] = useState(0);
    const [pricingIntentLoaded, setPricingIntentLoaded] = useState(false);
    const [pricingIntentAdjusted, setPricingIntentAdjusted] = useState(false);
    /** True when the person arrived from the pricing page having already chosen. */
    const [hasPricingIntent, setHasPricingIntent] = useState(false);
    const [showAllPlans, setShowAllPlans] = useState(false);
    const [countryOpen, setCountryOpen] = useState(false);

    // Protected. A person who already finished the signup does not belong here:
    // reopening `/onboarding` with a tenant would create a second one.
    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) { router.push("/login"); return; }
        try {
            const stored = localStorage.getItem("user");
            const parsed = stored ? JSON.parse(stored) : null;
            if (parsed?.tenantId && parsed?.onboardingCompleted) router.replace("/admin");
        } catch { /* usuario ilegible → seguir en el alta */ }
    }, [router]);

    // Query parameters have priority over the intent retained by signup. Each
    // field is validated independently; invalid URL input never becomes billing
    // state and the active catalog performs the final slug validation.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const queryIntent: PricingIntent = {
            plan: validPlanSlug(params.get("plan")),
            country: validCountry(params.get("country")),
            cycle: validCycle(params.get("cycle")),
        };
        const storedIntent = readStoredPricingIntent();
        const pricingIntent = {
            ...storedIntent,
            ...Object.fromEntries(Object.entries(queryIntent).filter(([, value]) => value !== undefined)),
        } as PricingIntent;

        setPlanSlug(pricingIntent.plan ?? "");
        setHasPricingIntent(Boolean(pricingIntent.plan));
        setShowAllPlans(Boolean(pricingIntent.plan));
        setBillingCountry(pricingIntent.country ?? browserBillingCountry() ?? "CO");
        setBillingCycle(pricingIntent.cycle ?? "monthly");
        setPricingIntentLoaded(true);
    }, []);

    useEffect(() => {
        if (!pricingIntentLoaded) return;
        let cancelled = false;
        setPlanCatalogLoading(true);
        setPlanCatalogError(false);

        api.getPublicBillingPlans(billingCountry)
            .then((result) => {
                if (cancelled) return;
                if (!result?.success || !Array.isArray(result.data)) {
                    setBillingPlans([]);
                    setPlanCatalogCountry(undefined);
                    setPlanCatalogError(true);
                    return;
                }
                setBillingPlans(result.data as BillingPlan[]);
                setPlanCatalogCountry(billingCountry);
            })
            .catch(() => {
                if (cancelled) return;
                setBillingPlans([]);
                setPlanCatalogCountry(undefined);
                setPlanCatalogError(true);
            })
            .finally(() => {
                if (!cancelled) setPlanCatalogLoading(false);
            });

        return () => { cancelled = true; };
    }, [billingCountry, planCatalogReloadKey, pricingIntentLoaded]);

    // Keep a requested live plan whenever possible. If its requested annual
    // cycle is unavailable, retain the plan and safely fall back to monthly.
    // With no request at all, land on the trial that asks for no card: that is
    // the only offer a person who has not decided anything can safely accept.
    useEffect(() => {
        if (planCatalogLoading || planCatalogError || planCatalogCountry !== billingCountry) return;
        if (billingPlans.length === 0) {
            if (planSlug) setPricingIntentAdjusted(true);
            setPlanSlug("");
            return;
        }

        const currentPlan = billingPlans.find((plan) => plan.slug === planSlug);
        if (currentPlan && isCycleAvailable(currentPlan, billingCycle)) return;

        if (currentPlan && billingCycle === "annual" && isCycleAvailable(currentPlan, "monthly")) {
            setBillingCycle("monthly");
            setPricingIntentAdjusted(true);
            return;
        }

        const trialFallback = billingPlans.find(isNoCardTrial);
        const sameCycleFallback = billingPlans.find((plan) => isCycleAvailable(plan, billingCycle));
        const monthlyFallback = billingPlans.find((plan) => isCycleAvailable(plan, "monthly"));
        const fallback = (!hasPricingIntent && trialFallback) || sameCycleFallback || monthlyFallback;

        if (planSlug) setPricingIntentAdjusted(true);
        if (fallback && !isCycleAvailable(fallback, billingCycle)) setBillingCycle("monthly");
        setPlanSlug(fallback?.slug ?? "");
    }, [billingCountry, billingCycle, billingPlans, hasPricingIntent, planCatalogCountry, planCatalogError, planCatalogLoading, planSlug]);

    // Keep the reconciled choice across verification/OAuth/reloads. It is
    // removed only after onboarding completes successfully.
    useEffect(() => {
        if (!pricingIntentLoaded) return;
        const pricingIntent: PricingIntent = {
            plan: planSlug || undefined,
            country: billingCountry,
            cycle: billingCycle,
        };
        try { sessionStorage.setItem(PRICING_INTENT_KEY, JSON.stringify(pricingIntent)); } catch { /* noop */ }
    }, [billingCountry, billingCycle, planSlug, pricingIntentLoaded]);

    // The API registry is the only source of truth for industries/subtypes.
    // Administrative creation consumes the same endpoint, preventing the two
    // onboarding paths from drifting when a subtype is added or renamed.
    useEffect(() => {
        let cancelled = false;
        setVerticalCatalogLoading(true);
        setVerticalCatalogError(false);

        api.getVerticalDefinitions()
            .then((result) => {
                if (cancelled) return;
                if (result.success && isCanonicalVerticalCatalog(result.data)) {
                    setVerticalDefinitions(result.data);
                    return;
                }
                setVerticalDefinitions({});
                setVerticalCatalogError(true);
            })
            .catch(() => {
                if (cancelled) return;
                setVerticalDefinitions({});
                setVerticalCatalogError(true);
            })
            .finally(() => {
                if (!cancelled) setVerticalCatalogLoading(false);
            });

        return () => { cancelled = true; };
    }, []);

    // A restored draft can contain an identifier removed from a newer manifest.
    // Clear only the invalid selection and keep the rest of the draft intact.
    useEffect(() => {
        if (verticalCatalogLoading || !industry) return;
        const available = verticalDefinitions[industry];
        if (!available) {
            setIndustry("");
            setSubType("");
            return;
        }
        if (subType && !available.some((candidate) => candidate.key === subType)) {
            setSubType("");
        }
    }, [industry, subType, verticalCatalogLoading, verticalDefinitions]);

    const [draftLoaded, setDraftLoaded] = useState(false);
    const [draftKey, setDraftKey] = useState<string | null>(null);

    // Restaurar borrador + detectar el huso del navegador. Ambas cosas son client-only:
    // hacerlo en el initializer del useState rompería la hidratación, porque el servidor
    // no conoce ni el localStorage ni la zona horaria del visitante.
    useEffect(() => {
        const key = draftKeyForCurrentUser();
        setDraftKey(key);

        let draft: any = null;
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : null;
            const fresh = parsed && typeof parsed.savedAt === "number"
                && Date.now() - parsed.savedAt < DRAFT_MAX_AGE_MS;
            if (fresh) draft = parsed;
            else if (raw) localStorage.removeItem(key);
        } catch { /* borrador corrupto → empezar limpio */ }

        if (draft && typeof draft === "object") {
            const str = (v: unknown) => (typeof v === "string" ? v : "");
            const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
            setCompanyName(str(draft.companyName));
            setWebsite(str(draft.website));
            setPhone(str(draft.phone));
            setBusinessEmail(str(draft.businessEmail));
            setAbout(str(draft.about));
            setInstagram(str(draft.instagram));
            setFacebook(str(draft.facebook));
            setLinkedin(str(draft.linkedin));
            setTiktok(str(draft.tiktok));
            setIndustry(str(draft.industry));
            setSubType(str(draft.subType));
            setOrgSize(str(draft.orgSize));
            setAudiences(arr(draft.audiences));
            setAudienceOther(str(draft.audienceOther));
            setGoals(arr(draft.goals));
            setGoalOther(str(draft.goalOther));
            setCouponCode(str(draft.couponCode).toUpperCase());
            if (TIMEZONE_VALUES.includes(str(draft.timezone))) setTimezone(draft.timezone);
            // Si el borrador trae algo en los campos opcionales, el acordeón se
            // abre solo: esconder lo que la persona ya escribió parece pérdida.
            if ([draft.website, draft.phone, draft.businessEmail, draft.instagram,
                draft.facebook, draft.linkedin, draft.tiktok, draft.couponCode]
                .some((value) => typeof value === "string" && value.trim())) {
                setDetailsOpen(true);
            }

            // Solo devolverlo a un paso avanzado si el paso 1 sigue completo; si no,
            // quedaría trabado en una pantalla que no puede validar.
            const step1Complete = !!str(draft.companyName).trim() && !!str(draft.industry)
                && !!str(draft.orgSize) && !!str(draft.about).trim();
            if (typeof draft.step === "number" && step1Complete) {
                setStep(Math.min(STEP_KEYS.length - 1, Math.max(0, draft.step)));
            }
        }

        if (!draft?.timezone) {
            try {
                const detected = normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
                if (TIMEZONE_VALUES.includes(detected)) setTimezone(detected);
            } catch { /* sin Intl → queda el default */ }
        }

        setDraftLoaded(true);
    }, []);

    // Guardar el borrador en cada cambio (después de restaurarlo, para no pisarlo con
    // el estado vacío del primer render).
    useEffect(() => {
        if (!draftLoaded || !draftKey) return;
        try {
            localStorage.setItem(draftKey, JSON.stringify({
                savedAt: Date.now(),
                step, companyName, website, phone, businessEmail, about,
                instagram, facebook, linkedin, tiktok,
                industry, subType, orgSize, timezone,
                audiences, audienceOther, goals, goalOther, couponCode,
            }));
        } catch { /* storage lleno o no disponible → seguir sin persistir */ }
    }, [draftLoaded, draftKey, step, companyName, website, phone, businessEmail, about,
        instagram, facebook, linkedin, tiktok, industry, subType, orgSize, timezone,
        audiences, audienceOther, goals, goalOther, couponCode]);

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

    const validationValues: ValidationValues = {
        companyName, website, phone, businessEmail, about,
        instagram, facebook, linkedin, tiktok,
        industry, subType, orgSize, timezone, couponCode,
    };

    const validateField = useCallback((field: FieldPath) => {
        const code = validateOnboardingField(field, {
            companyName, website, phone, businessEmail, about,
            instagram, facebook, linkedin, tiktok,
            industry, subType, orgSize, timezone, couponCode,
        });
        setFieldErrors((previous) => {
            const next = { ...previous };
            if (code) next[field] = code;
            else delete next[field];
            return next;
        });
        // El resaltado sirvió: no dejarlo prendido para siempre.
        if (!code) setHighlightField((current) => (current === field ? null : current));
        return code;
    }, [about, businessEmail, companyName, couponCode, facebook, industry, instagram,
        linkedin, orgSize, phone, subType, tiktok, timezone, website]);

    /** Every field this step owns; used to block "Siguiente" and to open the accordion. */
    const invalidFieldsForStep = (index: number): FieldPath[] =>
        (STEP_FIELDS[index] ?? []).filter((field) => validateOnboardingField(field, validationValues) !== null);

    const selectedPlan = billingPlans.find((plan) => plan.slug === planSlug);
    const annualCycleAvailable = billingPlans.some((plan) => isCycleAvailable(plan, "annual"));
    const planCatalogIsCurrent = !planCatalogLoading
        && !planCatalogError
        && planCatalogCountry === billingCountry;
    const billingCountryOptions = [...BILLING_COUNTRIES];
    const visiblePlans = showAllPlans || !selectedPlan
        ? billingPlans
        : billingPlans.filter((plan) => plan.slug === selectedPlan.slug);

    const canProceed = (): boolean => {
        if (invalidFieldsForStep(step).length > 0) return false;
        switch (step) {
            case 0:
                // `about` es requerido: es el campo más impactante para la calidad del
                // agente (alimenta <turn.business> → "¿qué hacen?"). Sin él, el agente
                // no puede describir el negocio desde el día 1.
                return verticalCatalogReady
                    && !!companyName.trim()
                    && !!industry
                    && (selectedSubTypes.length === 0 || !!subType)
                    && !!orgSize
                    && !!about.trim();
            case 1:
                return audiences.length > 0;
            case 2:
                return goals.length > 0;
            case 3:
                return planCatalogIsCurrent
                    && !!selectedPlan
                    && isCycleAvailable(selectedPlan, billingCycle);
            default:
                return false;
        }
    };

    const focusField = (field: FieldPath, targetStep: number) => {
        setStep(targetStep);
        setHighlightField(field);
        if (field.startsWith("company.socialMedia")
            || ["company.website", "company.phone", "company.email", "couponCode"].includes(field)) {
            setDetailsOpen(true);
        }
        setTimeout(() => {
            document.getElementById(fieldDomId(field))?.focus();
            document.getElementById(fieldDomId(field))?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 60);
    };

    const handleNext = () => {
        const invalid = invalidFieldsForStep(step);
        if (invalid.length > 0) {
            invalid.forEach(validateField);
            focusField(invalid[0], step);
            return;
        }
        if (!canProceed()) return;
        if (step < STEP_KEYS.length - 1) {
            setStep(step + 1);
        } else {
            handleSubmit();
        }
    };

    const handleSubmit = async () => {
        if (!planCatalogIsCurrent || !selectedPlan || !isCycleAvailable(selectedPlan, billingCycle)) {
            setError(t('planSelectionUnavailable'));
            return;
        }
        setError("");
        setIsSubmitting(true);
        const signupAttribution = readSignupAttribution();

        const data = {
            company: {
                name: companyName,
                website: normalizeWebsite(website) || undefined,
                phone: phone || undefined,
                email: businessEmail.trim() || undefined,
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
                country: billingCountry,
            },
            audiences: audiences.includes("other")
                ? [...audiences.filter((a) => a !== "other"), `other:${audienceOther}`]
                : audiences,
            goals: goals.includes("other")
                ? [...goals.filter((g) => g !== "other"), `other:${goalOther}`]
                : goals,
            // El idioma con el que está usando el dashboard es mejor señal que el huso
            // horario para decidir en qué idioma se siembra el agente y el contenido.
            locale,
            plan: selectedPlan.slug,
            billingCountry,
            billingCycle,
            couponCode: couponCode.trim() || undefined,
            signupSource: signupAttribution?.source,
            signupAttribution,
        };

        try {
            const result = await api.completeOnboarding(data);
            if (!result.success) {
                handleSubmitFailure(result);
                setIsSubmitting(false);
                return;
            }

            // Update tokens & user if returned
            if (result.data) {
                const d = result.data;
                if (d.accessToken) localStorage.setItem("accessToken", d.accessToken);
                if (d.refreshToken) localStorage.setItem("refreshToken", d.refreshToken);
                if (d.user) localStorage.setItem("user", JSON.stringify(d.user));
                if (d.verticalConfig && d.user?.tenantId) {
                    localStorage.setItem("verticalConfig", JSON.stringify({
                        tenantId: d.user.tenantId,
                        config: d.verticalConfig,
                    }));
                }
                // El backend nunca falla el alta por un cupón: informa el resultado
                // acá para que el usuario sepa si su código entró o no.
                if (d.coupon) setCouponNotice({ ok: !!d.coupon.applied, months: d.coupon.freeMonths });
            }

            const checkout = result.data?.billingCheckout;
            if (selectedPlan.requiresPaymentMethodAtSignup && !checkout) {
                // Never substitute another plan or grant paid access when the
                // server omitted the two-phase billing handoff.
                throw new Error(t('billingHandoffError'));
            }
            if (checkout?.requiresPaymentMethod) {
                const tenantId = result.data?.user?.tenantId;
                if (!tenantId) throw new Error(t('billingHandoffError'));
                saveBillingCheckoutIntent(sessionStorage, tenantId, {
                    kind: "upgrade",
                    planSlug: checkout.planSlug,
                    billingCycle: checkout.billingCycle,
                });
            }

            // El alta ya está hecha: el borrador no debe sobrevivir (si no, reaparecería
            // relleno la próxima vez que alguien abra /onboarding en este navegador).
            try {
                if (draftKey) localStorage.removeItem(draftKey);
                sessionStorage.removeItem(PRICING_INTENT_KEY);
                clearSignupAttribution();
            } catch { /* noop */ }

            // Paid onboarding is intentionally two-phase: the tenant and its
            // pending_auth subscription now exist, so Billing can attach the
            // tenant-owned Wompi source without granting paid entitlements.
            // Full page reload para que AuthContext re-lea los tokens nuevos con tenantId.
            setRedirecting(true);
            // Con aviso de cupón el puente se alarga: 1400 ms no alcanzan para leer
            // que el código no entró, y después de la redirección ya no hay dónde verlo.
            const bridgeDelay = result.data?.coupon ? 3600 : 1400;
            const checkoutTarget = checkout?.requiresPaymentMethod
                ? `/admin/settings/billing?resumePlan=${encodeURIComponent(checkout.planSlug)}&cycle=${checkout.billingCycle}&from=onboarding`
                : "/admin/setup-wizard";
            redirectTimerRef.current = setTimeout(() => { window.location.href = checkoutTarget; }, bridgeDelay);
            return;
        } catch (error) {
            setError(error instanceof Error ? error.message : t('connectionError'));
        }
        setIsSubmitting(false);
    };

    /**
     * A rejected signup used to print the server's raw sentence and leave the
     * person on the last screen, with no idea which of twelve fields was wrong.
     * The stable code becomes a translated message, and a field-level rejection
     * jumps back to the screen that owns the first offending field.
     */
    function handleSubmitFailure(result: { error?: string; errorCode?: string }) {
        const code = result.errorCode;
        const fields = (result as { fields?: Array<{ path?: unknown }> }).fields;

        if (code === "validation_failed") {
            const serverPath = Array.isArray(fields)
                ? fields.map((entry) => entry?.path).find((path): path is string => typeof path === "string" && Boolean(path))
                : undefined;
            // Sin `fields` en la respuesta, el validador del cliente —que es un
            // espejo del DTO— sabe igual cuál campo se rechazó.
            const localPath = ([0, 1, 2, 3] as const)
                .flatMap((index) => invalidFieldsForStep(index))[0];
            const path = serverPath ?? localPath;
            setError(t('validation.summary'));
            if (path) {
                const targetStep = stepForFieldPath(path);
                if (isFieldPath(path)) {
                    validateField(path);
                    focusField(path, targetStep);
                } else {
                    setStep(targetStep);
                }
            }
            return;
        }

        const known = ["plan_unavailable", "coupon_invalid", "email_taken", "tenant_exists", "rate_limited"];
        setError(code && known.includes(code)
            ? t(`errors.${code}`)
            : result.error || t('registrationError'));
    }

    // Puente visual /onboarding → setup-wizard: transición cohesiva antes del reload.
    if (redirecting) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
                <div className="text-center relative z-10">
                    <div className="mb-6"><AnimatedLogo height={44} animate showPoweredBy={false} /></div>
                    <div className="w-10 h-10 border-[3px] border-neutral-200 dark:border-white/15 border-t-indigo-500 rounded-full animate-spin mx-auto mb-5" />
                    {/* "¡Cuenta lista!" prometía algo que no era cierto: el agente
                        todavía no tiene canal. El puente ahora dice lo que sigue. */}
                    <h2 className="text-lg font-semibold text-foreground mb-1">{t('bridge.title')}</h2>
                    <p className="text-sm text-muted-foreground">{t('bridge.subtitle')}</p>
                    {couponNotice && (
                        <p
                            className={cn(
                                "text-sm mt-4 px-3 py-2 rounded-lg inline-block",
                                couponNotice.ok
                                    ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
                                    : "text-amber-700 dark:text-amber-300 bg-amber-500/10",
                            )}
                        >
                            {couponNotice.ok
                                ? t('couponApplied', { months: couponNotice.months ?? 1 })
                                : t('couponFailed')}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    const fieldProps = (field: FieldPath) => ({
        id: fieldDomId(field),
        onBlur: () => validateField(field),
        className: cn(
            inputWithIconClasses,
            fieldErrors[field] && inputErrorClasses,
            highlightField === field && "ring-2 ring-indigo-400",
        ),
    });

    const FieldError = ({ field }: { field: FieldPath }) => fieldErrors[field]
        ? <p className="mt-1.5 text-[12px] text-rose-500">{t(`validation.${fieldErrors[field]}`)}</p>
        : null;

    // Las listas por industria viven en el catálogo de mensajes; acá sólo se
    // leen sus claves, así que agregar una audiencia es editar un JSON.
    const verticalAudienceKeys = industry && t.has(`verticalAudiences.${industry}`)
        ? Object.keys(t.raw(`verticalAudiences.${industry}`) as Record<string, string>)
        : null;
    const verticalGoalKeys = industry && t.has(`verticalGoals.${industry}`)
        ? Object.keys(t.raw(`verticalGoals.${industry}`) as Record<string, string>)
        : null;

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
            {/* Background glow effects */}
            <div className="hidden dark:block fixed top-[20%] left-[30%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(circle,rgba(108,92,231,0.15)_0%,transparent_70%)] blur-[60px] pointer-events-none" />
            <div className="hidden dark:block fixed bottom-[10%] right-[20%] w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle,rgba(46,204,113,0.1)_0%,transparent_70%)] blur-[60px] pointer-events-none" />

            <div className="w-full max-w-[520px] relative z-10">
                {/* Idioma y ayuda. El idioma del tenant se decide EN esta pantalla:
                    sin el selector, alguien que llega de Brasil sin cookie se
                    quedaba con un agente sembrado en español. */}
                <div className="flex items-center justify-between gap-3 mb-4">
                    <a
                        href={SUPPORT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground no-underline transition-colors hover:text-indigo-500"
                    >
                        <LifeBuoy size={14} /> {t('helpLink')}
                    </a>
                    <LocaleSwitcher />
                </div>

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
                            <h2 className="text-xl font-semibold text-foreground mb-1">{t('step1Title')}</h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {t('step1Subtitle')}
                            </p>

                            {/* Company Name */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor={fieldDomId("company.name")}>
                                    {t('companyName')} <span className="text-rose-500">*</span>
                                </label>
                                <div className="relative">
                                    <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="text"
                                        value={companyName}
                                        onChange={(e) => setCompanyName(e.target.value)}
                                        placeholder={t('companyNamePlaceholder')}
                                        {...fieldProps("company.name")}
                                    />
                                </div>
                                <FieldError field="company.name" />
                            </div>

                            {/* Industry */}
                            <div className="mb-4" id="onboarding-industry-field">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor="onboarding-industry">
                                    {t('industry')} <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    id="onboarding-industry"
                                    value={industry}
                                    disabled={!verticalCatalogReady || verticalCatalogLoading}
                                    // Audiencias y objetivos son listas por vertical: si no se
                                    // limpian al cambiar de industria, el usuario avanza con
                                    // selecciones de otro rubro que ya no ve en pantalla.
                                    onChange={(e) => {
                                        setIndustry(e.target.value);
                                        setSubType("");
                                        setAudiences([]);
                                        setAudienceOther("");
                                        setGoals([]);
                                        setGoalOther("");
                                    }}
                                    className={cn(selectClasses, "pr-8")}
                                    style={selectChevron}
                                >
                                    <option value="" disabled>—</option>
                                    {industryKeys.map((key) => (
                                        <option key={key} value={key} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                            {t(`industries.${key}`)}
                                        </option>
                                    ))}
                                </select>
                                {(verticalCatalogLoading || verticalCatalogError) && (
                                    <p className={cn(
                                        "mt-1.5 text-[11px]",
                                        verticalCatalogError ? "text-rose-500" : "text-muted-foreground",
                                    )}>
                                        {verticalCatalogLoading
                                            ? t('verticalCatalogLoading')
                                            : t('verticalCatalogError')}
                                    </p>
                                )}
                            </div>

                            {/* Sub-type (conditional) */}
                            {selectedSubTypes.length > 0 && (
                                <div className="mb-4">
                                    <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor="onboarding-subtype">
                                        {t('businessType')}
                                    </label>
                                    {/* La frontera belleza/salud es la que más se
                                        equivoca el dueño: una clínica de estética
                                        puede razonablemente anotarse en cualquiera
                                        de las dos, y de esa elección depende todo
                                        lo que le sembramos. La regla del médico
                                        prescribiendo la resuelve sin ambigüedad. */}
                                    {(industry === 'moda_belleza' || industry === 'salud') && (
                                        <p className="text-[11px] text-muted-foreground mb-1.5 -mt-0.5">
                                            {t('businessTypeHint')}
                                        </p>
                                    )}
                                    <select
                                        id="onboarding-subtype"
                                        value={subType}
                                        onChange={(e) => setSubType(e.target.value)}
                                        className={cn(selectClasses, "pr-8")}
                                        style={selectChevron}
                                    >
                                        <option value="">{t('select')}</option>
                                        {selectedSubTypes.map((st) => (
                                            <option key={st.key} value={st.key} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                                {getVerticalLabel(st, catalogLocale)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* About — fed into the agent's <turn.business> block */}
                            <div className="mb-4" id="onboarding-about-field">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor={fieldDomId("company.about")}>
                                    {t('about')} <span className="text-rose-500">*</span>
                                </label>
                                <div className="relative">
                                    <Info size={16} className="absolute left-3.5 top-3 text-muted-foreground/50" />
                                    <textarea
                                        value={about}
                                        onChange={(e) => setAbout(e.target.value)}
                                        placeholder={t('aboutPlaceholder')}
                                        rows={3}
                                        id={fieldDomId("company.about")}
                                        onBlur={() => validateField("company.about")}
                                        className={cn(
                                            inputWithIconClasses,
                                            "pt-3 pb-3 resize-y min-h-[80px]",
                                            fieldErrors["company.about"] && inputErrorClasses,
                                            highlightField === "company.about" && "ring-2 ring-indigo-400",
                                        )}
                                    />
                                </div>
                                <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                                    {t('aboutHint')}
                                </p>
                                <FieldError field="company.about" />
                            </div>

                            {/* Org Size */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor="onboarding-orgsize">
                                    {t('companySize')} <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    id="onboarding-orgsize"
                                    value={orgSize}
                                    onChange={(e) => setOrgSize(e.target.value)}
                                    className={cn(selectClasses, "pr-8")}
                                    style={selectChevron}
                                >
                                    <option value="" disabled>—</option>
                                    {ORG_SIZE_KEYS.map((key) => (
                                        <option key={key} value={key} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                            {t(`orgSizes.${key}`)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Timezone — ya la sabemos por el navegador. Presentarla como
                                un campo obligatorio más hacía que pareciera una decisión;
                                es una confirmación. */}
                            <div className="mb-4" id="onboarding-timezone-field">
                                {!timezoneOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => setTimezoneOpen(true)}
                                        className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-indigo-400 hover:text-foreground dark:border-white/10 dark:bg-white/5 cursor-pointer"
                                    >
                                        <Clock size={13} />
                                        {t('timezoneDetected', { zone: timezone })}
                                        <span className="font-semibold text-indigo-500">{t('timezoneChange')}</span>
                                    </button>
                                ) : (
                                    <>
                                        <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor="onboarding-timezone">
                                            {t('timezone')}
                                        </label>
                                        <select
                                            id="onboarding-timezone"
                                            value={timezone}
                                            autoFocus
                                            onChange={(e) => setTimezone(e.target.value)}
                                            className={cn(selectClasses, "pr-8")}
                                            style={selectChevron}
                                        >
                                            {TIMEZONE_GROUPS.map((g) => (
                                                <optgroup key={g.region} label={g.region}>
                                                    {g.zones.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                                                </optgroup>
                                            ))}
                                        </select>
                                    </>
                                )}
                            </div>

                            {/* Todo lo demás es opcional. Trece campos visibles hacían que
                                el alta pareciera un trámite; ahora son cuatro más un
                                cajón para quien quiera completarlo hoy. */}
                            <div className="rounded-xl border border-neutral-200 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setDetailsOpen((open) => !open)}
                                    aria-expanded={detailsOpen}
                                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[13px] font-medium text-foreground cursor-pointer"
                                >
                                    <span>
                                        {t('moreDetails')}
                                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{t('moreDetailsHint')}</span>
                                    </span>
                                    <ChevronDown size={16} className={cn("shrink-0 text-muted-foreground transition-transform", detailsOpen && "rotate-180")} />
                                </button>

                                {detailsOpen && (
                                    <div className="border-t border-neutral-200 px-4 py-4 dark:border-white/10">
                                        {/* Website */}
                                        <div className="mb-4">
                                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor={fieldDomId("company.website")}>
                                                {t('website')}
                                            </label>
                                            <div className="relative">
                                                <Globe size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                                <input
                                                    type="text"
                                                    inputMode="url"
                                                    value={website}
                                                    onChange={(e) => setWebsite(e.target.value)}
                                                    placeholder="https://..."
                                                    {...fieldProps("company.website")}
                                                />
                                            </div>
                                            <FieldError field="company.website" />
                                        </div>

                                        {/* Business Contact — used by the AI agent when customers ask */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                            <div>
                                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor={fieldDomId("company.phone")}>
                                                    {t('businessPhone')}
                                                </label>
                                                <div className="relative">
                                                    <Phone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                                    <input
                                                        type="tel"
                                                        value={phone}
                                                        onChange={(e) => setPhone(e.target.value)}
                                                        placeholder={t('businessPhonePlaceholder')}
                                                        {...fieldProps("company.phone")}
                                                    />
                                                </div>
                                                <FieldError field="company.phone" />
                                            </div>
                                            <div>
                                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor={fieldDomId("company.email")}>
                                                    {t('businessEmail')}
                                                </label>
                                                <div className="relative">
                                                    <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                                    <input
                                                        type="email"
                                                        value={businessEmail}
                                                        onChange={(e) => setBusinessEmail(e.target.value)}
                                                        placeholder={t('businessEmailPlaceholder')}
                                                        {...fieldProps("company.email")}
                                                    />
                                                </div>
                                                <FieldError field="company.email" />
                                            </div>
                                        </div>

                                        {/* Social Media */}
                                        <div className="mb-4">
                                            <label className="block text-[13px] text-muted-foreground mb-2 font-medium">
                                                {t('socialMedia')}
                                            </label>
                                            <div className="space-y-2.5">
                                                <div className="relative">
                                                    <Instagram size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                                    <input
                                                        type="text"
                                                        value={instagram}
                                                        onChange={(e) => setInstagram(e.target.value)}
                                                        placeholder={t('instagramUrl')}
                                                        {...fieldProps("company.socialMedia.instagram")}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <Facebook size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                                    <input
                                                        type="text"
                                                        value={facebook}
                                                        onChange={(e) => setFacebook(e.target.value)}
                                                        placeholder={t('facebookUrl')}
                                                        {...fieldProps("company.socialMedia.facebook")}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <Linkedin size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                                    <input
                                                        type="text"
                                                        value={linkedin}
                                                        onChange={(e) => setLinkedin(e.target.value)}
                                                        placeholder={t('linkedinUrl')}
                                                        {...fieldProps("company.socialMedia.linkedin")}
                                                    />
                                                </div>
                                                <div className="relative">
                                                    <TikTokIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                                    <input
                                                        type="text"
                                                        value={tiktok}
                                                        onChange={(e) => setTiktok(e.target.value)}
                                                        placeholder={t('tiktokUrl')}
                                                        {...fieldProps("company.socialMedia.tiktok")}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Código promocional — opcional. Va acá y no en una pantalla
                                            aparte porque el alta es trial-first: el cupón extiende el
                                            trial en el mismo submit, sin pedir tarjeta. */}
                                        <div>
                                            <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium" htmlFor={fieldDomId("couponCode")}>
                                                {t('couponLabel')}
                                            </label>
                                            <input
                                                type="text"
                                                value={couponCode}
                                                onChange={(e) => setCouponCode(e.target.value.toUpperCase().trim())}
                                                placeholder={t('couponPlaceholder')}
                                                maxLength={40}
                                                id={fieldDomId("couponCode")}
                                                onBlur={() => validateField("couponCode")}
                                                className={cn(inputClasses, "font-mono uppercase", fieldErrors.couponCode && inputErrorClasses)}
                                            />
                                            <p className="text-[12px] text-muted-foreground mt-1">{t('couponHint')}</p>
                                            <FieldError field="couponCode" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 2: Audience */}
                    {step === 1 && (
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-1">
                                {t('step2')}
                            </h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {t('audienceTitle')}
                            </p>

                            <div className="space-y-3">
                                {(verticalAudienceKeys ?? AUDIENCE_KEYS).map((key) => (
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
                                        <span className="text-sm text-foreground">
                                            {verticalAudienceKeys
                                                ? t(`verticalAudiences.${industry}.${key}`)
                                                : t(`audiences.${key}`)}
                                        </span>
                                    </label>
                                ))}

                                {audiences.includes("other") && !verticalAudienceKeys && (
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
                                {t('goalsTitle')}
                            </h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {t('step3')}
                            </p>

                            <div className="space-y-3">
                                {(verticalGoalKeys ?? GOAL_KEYS).map((key) => (
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
                                        <span className="text-sm text-foreground">
                                            {verticalGoalKeys && GOAL_ICONS[key] && <span className="mr-1.5">{GOAL_ICONS[key]}</span>}
                                            {verticalGoalKeys
                                                ? t(`verticalGoals.${industry}.${key}`)
                                                : t(`goals.${key}`)}
                                        </span>
                                    </label>
                                ))}

                                {goals.includes("other") && !verticalGoalKeys && (
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

                    {/* Step 4: live plan catalog */}
                    {step === 3 && (
                        <div>
                            <h2 className="text-xl font-semibold text-foreground mb-1">{t('planTitle')}</h2>
                            <p className="text-muted-foreground text-sm mb-6">{t('planSubtitle')}</p>

                            {/* El país es una confirmación, no una pregunta: se deduce del
                                navegador y sólo se abre si está mal. */}
                            <div className="mb-4">
                                {!countryOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => setCountryOpen(true)}
                                        className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-indigo-400 hover:text-foreground dark:border-white/10 dark:bg-white/5 cursor-pointer"
                                    >
                                        <Globe size={13} />
                                        {t('billingCountryDetected', { country: billingCountryLabel(billingCountry ?? "CO", locale) })}
                                        <span className="font-semibold text-indigo-500">{t('timezoneChange')}</span>
                                    </button>
                                ) : (
                                    <>
                                        <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground" htmlFor="billing-country">
                                            {t('billingCountry')}
                                        </label>
                                        <select
                                            id="billing-country"
                                            value={billingCountry ?? "CO"}
                                            autoFocus
                                            onChange={(event) => {
                                                setBillingCountry(event.target.value);
                                                setPricingIntentAdjusted(false);
                                            }}
                                            className={selectClasses}
                                        >
                                            {billingCountryOptions.map((country) => (
                                                <option key={country} value={country}>
                                                    {billingCountryLabel(country, locale)} ({country})
                                                </option>
                                            ))}
                                        </select>
                                        <p className="mt-1 text-xs text-muted-foreground">{t('billingCountryHint')}</p>
                                    </>
                                )}
                            </div>

                            {pricingIntentAdjusted && (
                                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                    {t('planIntentAdjusted')}
                                </div>
                            )}

                            {planCatalogIsCurrent && annualCycleAvailable && showAllPlans && (
                                <div className="mb-4 inline-flex rounded-lg border border-neutral-200 p-0.5 text-sm dark:border-white/10">
                                    {(["monthly", "annual"] as BillingCycle[]).map((cycle) => (
                                        <button
                                            key={cycle}
                                            type="button"
                                            onClick={() => {
                                                setBillingCycle(cycle);
                                                setPricingIntentAdjusted(false);
                                            }}
                                            className={cn(
                                                "rounded-md px-3 py-1.5 font-medium transition-colors",
                                                billingCycle === cycle
                                                    ? "bg-indigo-600 text-white"
                                                    : "text-muted-foreground hover:text-foreground",
                                            )}
                                        >
                                            {cycle === "monthly" ? t('cycleMonthly') : t('cycleAnnual')}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {!planCatalogIsCurrent && !planCatalogError ? (
                                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-indigo-500" />
                                    {t('planCatalogLoading')}
                                </div>
                            ) : planCatalogError ? (
                                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-900 dark:bg-red-950/30">
                                    <p className="text-sm text-red-700 dark:text-red-300">{t('planCatalogError')}</p>
                                    <button
                                        type="button"
                                        onClick={() => setPlanCatalogReloadKey((value) => value + 1)}
                                        className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                                    >
                                        {t('retry')}
                                    </button>
                                </div>
                            ) : billingPlans.length === 0 ? (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                    {t('planCatalogEmpty')}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {visiblePlans.map((plan) => {
                                        const available = isCycleAvailable(plan, billingCycle);
                                        const active = planSlug === plan.slug;
                                        const single = visiblePlans.length === 1;
                                        const amount = billingCycle === "annual"
                                            ? plan.displayPriceAnnualCents
                                            : plan.displayPriceCents;
                                        const channels = Array.isArray(plan.features?.channels)
                                            ? plan.features.channels.length
                                            : null;
                                        const messages = plan.maxAiMessages < 0
                                            ? t('unlimited')
                                            : new Intl.NumberFormat(locale).format(plan.maxAiMessages);
                                        const agents = plan.maxAgents < 0
                                            ? t('unlimited')
                                            : new Intl.NumberFormat(locale).format(plan.maxAgents);
                                        const customPricing = plan.features?.salesLed === true
                                            || (plan.checkoutMode === "contact_sales" && amount === 0);

                                        return (
                                            <label
                                                key={plan.id ?? plan.slug}
                                                className={cn(
                                                    "flex items-start gap-3 rounded-xl border p-4 transition-all",
                                                    available ? "cursor-pointer" : "cursor-not-allowed opacity-70",
                                                    active
                                                        ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10"
                                                        : "border-neutral-200 bg-neutral-50 dark:border-white/10 dark:bg-white/[0.03]",
                                                )}
                                            >
                                                <input
                                                    type="radio"
                                                    name="plan"
                                                    checked={active}
                                                    disabled={!available}
                                                    onChange={() => {
                                                        setPlanSlug(plan.slug);
                                                        setPricingIntentAdjusted(false);
                                                    }}
                                                    className={cn(
                                                        "mt-1 h-4 w-4 border-neutral-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-500 dark:border-white/20",
                                                        single && "sr-only",
                                                    )}
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                                                        <span className="text-right text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                                                            {customPricing
                                                                ? t('customPrice')
                                                                : typeof amount === "number" && Number.isFinite(amount)
                                                                    ? `${formatMoney(amount, plan.displayCurrency, locale)} / ${billingCycle === "annual" ? t('perYear') : t('perMonth')}`
                                                                    : t('priceUnavailable')}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {t('agentsIncluded', { n: agents })}
                                                        {" · "}{t('messagesIncluded', { n: messages })}
                                                        {channels !== null && <>{" · "}{t('channelsIncluded', { n: channels })}</>}
                                                    </p>
                                                    {billingCycle === "monthly" && plan.trialAvailable ? (
                                                        <div className="mt-2 text-[11px] text-muted-foreground">
                                                            <p>
                                                                {t('trialDays', { n: plan.trialDays })}
                                                                {" · "}{t('noCardRequired')}
                                                            </p>
                                                            {!plan.monthlyAvailable && (
                                                                <p className="mt-1 font-medium text-amber-600 dark:text-amber-400">
                                                                    {t('trialRenewalAvailability')}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ) : plan.signupUnavailableReason === "card_trial_not_supported" ? (
                                                        <p className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                                            {t('cardTrialNotSupported')}
                                                        </p>
                                                    ) : plan.checkoutMode === "contact_sales" ? (
                                                        <p className="mt-2 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">{t('planContactSales')}</p>
                                                    ) : !available ? (
                                                        <p className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">{t('planTemporarilyUnavailable')}</p>
                                                    ) : plan.trialDays > 0 ? (
                                                        <p className="mt-2 text-[11px] text-muted-foreground">
                                                            {t('trialDays', { n: plan.trialDays })}
                                                            {" · "}{plan.requiresCardForTrial ? t('requiresCardNote') : t('noCardRequired')}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            </label>
                                        );
                                    })}

                                    {/* Cuatro planes con precios en la pantalla final del alta
                                        son cuatro decisiones que nadie pidió tomar todavía. */}
                                    {!showAllPlans && billingPlans.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => setShowAllPlans(true)}
                                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-neutral-200 px-4 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground dark:border-white/10 cursor-pointer"
                                        >
                                            {t('seeOtherPlans')} <ChevronDown size={14} />
                                        </button>
                                    )}
                                </div>
                            )}

                            {showAllPlans && !planCatalogError && !planCatalogLoading && billingPlans.some((plan) =>
                                plan.checkoutMode === "contact_sales"
                                || plan.signupUnavailableReason === "card_trial_not_supported") && (
                                <p className="mt-3 text-center text-xs text-muted-foreground">
                                    {t('contactSalesHint')}{" "}
                                    <a
                                        href={`mailto:${SALES_EMAIL}`}
                                        className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                                    >
                                        {t('contactSalesAction')}
                                    </a>
                                </p>
                            )}

                            {/* La tarjeta no se pide aca. La fuente de pago del
                                operador (Wompi) pertenece al tenant, y el tenant
                                nace al completar este formulario: el plan con
                                cobro se activa desde Configuracion → Facturacion,
                                donde la tarjeta queda guardada y el cobro se
                                agenda al vencer la prueba. */}
                            {selectedPlan?.requiresPaymentMethodAtSignup && (
                                <div className="mt-5 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 text-sm text-indigo-800 dark:text-indigo-300">
                                    {t('paidPlanAfterSignup', { plan: selectedPlan.name })}
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
                                <ChevronLeft size={16} /> {t('back')}
                            </button>
                        ) : (
                            <div />
                        )}

                        <button
                            id="onboarding-next-button"
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
                                    {t('creating')}
                                </>
                            ) : step === STEP_KEYS.length - 1 ? (
                                t('createAccount')
                            ) : (
                                <>
                                    {t('next')} <ChevronRight size={16} />
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-neutral-400 mt-6">{t('poweredBy')} <a href="https://parallext.com" target="_blank" className="text-indigo-500 hover:text-indigo-400">Parallext.com</a></p>
            </div>

            {step === 0 && draftLoaded && verticalCatalogReady && (
                <CoachMarks
                    storageKey={COACH_MARKS_KEY}
                    marks={[
                        { targetId: "onboarding-industry-field", key: "industry" },
                        { targetId: "onboarding-about-field", key: "about" },
                        { targetId: "onboarding-timezone-field", key: "timezone" },
                        { targetId: "onboarding-next-button", key: "submit" },
                    ]}
                />
            )}
        </div>
    );
}

function fieldDomId(field: FieldPath): string {
    return `onboarding-${field.replace(/\./g, "-")}`;
}

function isFieldPath(value: string): value is FieldPath {
    return (STEP_FIELDS[0] as string[]).includes(value);
}

/**
 * First-visit coach marks.
 *
 * Not a product tour: those live in `/admin` and need the tour runner. This is
 * four sentences pointing at the four things that matter on the first screen a
 * person ever sees, shown once per browser. Without them the honest reaction to
 * a form with an accordion is "what do I actually have to fill in?".
 */
function CoachMarks({
    marks,
    storageKey,
}: {
    marks: { targetId: string; key: string }[];
    storageKey: string;
}) {
    const t = useTranslations("onboarding.coachMarks");
    const [index, setIndex] = useState<number | null>(null);
    const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

    useEffect(() => {
        try {
            if (!localStorage.getItem(storageKey)) setIndex(0);
        } catch { /* sin storage → no molestar */ }
    }, [storageKey]);

    const dismiss = useCallback(() => {
        setIndex(null);
        try { localStorage.setItem(storageKey, "1"); } catch { /* noop */ }
    }, [storageKey]);

    useEffect(() => {
        if (index === null) return;
        const mark = marks[index];
        if (!mark) { dismiss(); return; }

        const measure = () => {
            const element = document.getElementById(mark.targetId);
            if (!element) { setBox(null); return; }
            const rect = element.getBoundingClientRect();
            setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
        };
        measure();
        const raf = requestAnimationFrame(measure);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [dismiss, index, marks]);

    if (index === null || !box) return null;
    const mark = marks[index];
    const isLast = index === marks.length - 1;
    const bubbleWidth = 280;
    const left = Math.min(Math.max(box.left, 12), Math.max(12, window.innerWidth - bubbleWidth - 12));
    const below = box.top + box.height + 10;
    const top = below + 130 > window.innerHeight ? Math.max(12, box.top - 140) : below;

    return (
        <div className="pointer-events-none fixed inset-0 z-50">
            <div
                className="absolute rounded-xl ring-2 ring-indigo-500 ring-offset-2 ring-offset-transparent transition-all"
                style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }}
            />
            <div
                className="pointer-events-auto absolute rounded-xl border border-indigo-200 bg-white p-4 shadow-xl dark:border-indigo-500/30 dark:bg-[#16162c]"
                style={{ top, left, width: bubbleWidth }}
                role="dialog"
                aria-label={t(`${mark.key}.title`)}
            >
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label={t("skip")}
                    className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                >
                    <X size={14} />
                </button>
                <p className="pr-5 text-[13px] font-semibold text-foreground">{t(`${mark.key}.title`)}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t(`${mark.key}.body`)}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{index + 1}/{marks.length}</span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={dismiss}
                            className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                        >
                            {t("skip")}
                        </button>
                        <button
                            type="button"
                            onClick={() => (isLast ? dismiss() : setIndex(index + 1))}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-indigo-700 cursor-pointer"
                        >
                            {isLast ? t("done") : t("next")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
