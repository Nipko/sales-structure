"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Building2, Globe, ChevronLeft, ChevronRight,
    AlertCircle, Instagram, Facebook, Linkedin,
    Phone, Mail, Info,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { TIMEZONE_GROUPS, TIMEZONE_VALUES, DEFAULT_TIMEZONE, normalizeTimezone } from "@parallext/shared";
import AnimatedLogo from "@/components/AnimatedLogo";
import MpCardForm from "@/components/billing/MpCardForm";

// Ruta crítica mínima (trial-first): empresa → audiencia → objetivos.
// Los pasos "referido" (marketing) y "plan/tarjeta" (muro de pago) se quitaron del
// flujo: el usuario arranca con trial de plan "emprendedor" sin tarjeta y el upgrade
// vive en Configuración → Billing. (El JSX de esos pasos queda inerte: step nunca llega.)
const STEP_KEYS = ["step1", "step2", "step3"];

// Borrador local. El wizard no hace ninguna llamada al servidor hasta el submit final,
// así que cerrar la pestaña —o que el navegador del celular la descarte en segundo
// plano— borraba todo lo tipeado y devolvía al usuario a un formulario en blanco.
// Se guarda por usuario (un navegador compartido no debe mostrarle los datos de una
// empresa a otra persona), caduca a los 7 días y se borra al completar el alta.
const DRAFT_PREFIX = "parallly:onboarding:draft";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function draftKeyForCurrentUser(): string {
    try {
        const raw = localStorage.getItem("user");
        const id = raw ? JSON.parse(raw)?.id : null;
        if (id) return `${DRAFT_PREFIX}:${id}`;
    } catch { /* usuario ilegible → clave anónima */ }
    return `${DRAFT_PREFIX}:anon`;
}

const PLAN_SLUGS = ["emprendedor", "starter", "pro", "enterprise"] as const;
type PlanSlug = typeof PLAN_SLUGS[number];

const INDUSTRY_KEYS = [
    "turismo", "education", "salud", "veterinaria", "retail", "technology",
    "servicios_profesionales", "restaurantes", "inmobiliaria",
    "automotriz", "finanzas", "moda_belleza", "gimnasios", "seguros",
    "servicios_hogar", "pet_services", "fotografia", "otro",
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
    veterinaria: [
        { key: 'clinica_general', label: 'Clínica de pequeñas especies' },
        { key: 'hospital_24h', label: 'Hospital veterinario 24h' },
        { key: 'exoticos', label: 'Animales exóticos' },
        { key: 'peluqueria_canina', label: 'Peluquería canina / felina' },
    ],
    gimnasios: [
        { key: 'gimnasio_general', label: 'Gimnasio tradicional' },
        { key: 'crossfit', label: 'Box CrossFit' },
        { key: 'yoga_pilates', label: 'Estudio de yoga / pilates' },
        { key: 'cycling', label: 'Cycling / spinning' },
        { key: 'martial_arts', label: 'Artes marciales' },
    ],
    seguros: [
        { key: 'broker', label: 'Broker / Corredor' },
        { key: 'aseguradora', label: 'Aseguradora' },
        { key: 'vida', label: 'Especialista en vida' },
        { key: 'auto', label: 'Especialista en auto' },
        { key: 'salud', label: 'Especialista en salud' },
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
    pet_services: [
        { key: 'peluqueria', label: 'Peluquería canina / felina' },
        { key: 'guarderia', label: 'Guardería y hotel' },
        { key: 'paseos', label: 'Paseos y cuidado a domicilio' },
        { key: 'entrenamiento', label: 'Entrenamiento y adiestramiento' },
        { key: 'tienda', label: 'Tienda de mascotas' },
    ],
    servicios_hogar: [
        { key: 'plomeria', label: 'Plomería' },
        { key: 'electricidad', label: 'Electricidad' },
        { key: 'cerrajeria', label: 'Cerrajería' },
        { key: 'limpieza', label: 'Limpieza profesional' },
        { key: 'pintura', label: 'Pintura y remodelación' },
        { key: 'multiservicio', label: 'Multiservicio / General' },
    ],
    fotografia: [
        { key: 'bodas', label: 'Bodas y eventos' },
        { key: 'retrato', label: 'Retrato y book' },
        { key: 'producto', label: 'Fotografía de producto' },
        { key: 'corporativo', label: 'Corporativo y empresas' },
        { key: 'inmobiliaria', label: 'Fotografía inmobiliaria' },
    ],
};

const VERTICAL_GOALS: Record<string, Array<{key: string; label: string; icon: string}>> = {
    salud: [
        { key: 'appointments', label: 'Agendar citas médicas', icon: '📅' },
        { key: 'faq', label: 'Responder preguntas de pacientes', icon: '❓' },
        { key: 'support', label: 'Atención y seguimiento post-consulta', icon: '💊' },
        { key: 'reminders', label: 'Recordatorios de citas y tratamientos', icon: '🔔' },
    ],
    veterinaria: [
        { key: 'appointments', label: 'Agendar consultas y vacunaciones', icon: '🐾' },
        { key: 'reminders', label: 'Recordatorios de vacunación', icon: '💉' },
        { key: 'faq', label: 'Responder preguntas de tutores', icon: '❓' },
        { key: 'support', label: 'Triage de emergencias', icon: '🚨' },
    ],
    gimnasios: [
        { key: 'sales', label: 'Vender membresías', icon: '💪' },
        { key: 'appointments', label: 'Reservar clases grupales', icon: '🧘' },
        { key: 'faq', label: 'Información de planes y horarios', icon: '❓' },
        { key: 'reminders', label: 'Recordatorios de renovación', icon: '🔔' },
    ],
    seguros: [
        { key: 'sales', label: 'Cotizar y vender pólizas', icon: '📋' },
        { key: 'support', label: 'Atender reclamos y siniestros', icon: '🚨' },
        { key: 'faq', label: 'Información de planes y coberturas', icon: '❓' },
        { key: 'reminders', label: 'Recordatorios de renovación', icon: '🔔' },
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
    retail: [
        { key: 'sales', label: 'Recomendar y vender productos', icon: '🛍️' },
        { key: 'faq', label: 'Consultar stock y precios', icon: '📦' },
        { key: 'promotions', label: 'Enviar promociones y ofertas', icon: '🎁' },
        { key: 'support', label: 'Soporte postventa y devoluciones', icon: '📞' },
    ],
    technology: [
        { key: 'lead_qualification', label: 'Calificar leads B2B', icon: '🎯' },
        { key: 'appointments', label: 'Agendar demos y reuniones', icon: '💻' },
        { key: 'support', label: 'Soporte técnico nivel 1', icon: '🔧' },
        { key: 'faq', label: 'FAQ de producto y documentación', icon: '📖' },
    ],
    pet_services: [
        { key: 'appointments', label: 'Agendar peluquería, guardería y paseos', icon: '🐾' },
        { key: 'sales', label: 'Recomendar productos para mascotas', icon: '🛒' },
        { key: 'faq', label: 'Información de servicios y requisitos', icon: '❓' },
        { key: 'reminders', label: 'Recordatorios de citas y vacunas', icon: '🔔' },
    ],
    servicios_hogar: [
        { key: 'sales', label: 'Cotizar servicios y reparaciones', icon: '🔧' },
        { key: 'appointments', label: 'Agendar visitas del técnico', icon: '📅' },
        { key: 'support', label: 'Seguimiento y garantía postventa', icon: '✅' },
        { key: 'faq', label: 'Información de coberturas y precios', icon: '💰' },
    ],
    fotografia: [
        { key: 'sales', label: 'Cotizar paquetes y sesiones', icon: '📸' },
        { key: 'appointments', label: 'Agendar sesiones fotográficas', icon: '📅' },
        { key: 'support', label: 'Gestionar entregas y galerías', icon: '🖼️' },
        { key: 'promotions', label: 'Enviar portafolio y promociones', icon: '🎨' },
    ],
};


const VERTICAL_AUDIENCES: Record<string, Array<{key: string; label: string}>> = {
    salud: [
        { key: 'b2c', label: 'Pacientes particulares' },
        { key: 'b2b', label: 'Empresas y convenios' },
        { key: 'insurance', label: 'Pacientes con seguro médico' },
    ],
    veterinaria: [
        { key: 'b2c', label: 'Tutores particulares' },
        { key: 'breeders', label: 'Criaderos / refugios' },
        { key: 'b2b', label: 'Convenios corporativos' },
    ],
    gimnasios: [
        { key: 'b2c', label: 'Miembros individuales' },
        { key: 'corporate', label: 'Convenios corporativos' },
        { key: 'fit_groups', label: 'Grupos / equipos deportivos' },
    ],
    seguros: [
        { key: 'b2c', label: 'Personas naturales' },
        { key: 'b2b', label: 'Empresas y PYMES' },
        { key: 'agentes', label: 'Otros agentes / red de ventas' },
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
    retail: [
        { key: 'b2c', label: 'Compradores individuales' },
        { key: 'b2b', label: 'Clientes mayoristas / B2B' },
        { key: 'online', label: 'Compradores online' },
    ],
    technology: [
        { key: 'b2b', label: 'Empresas y PYMES' },
        { key: 'startups', label: 'Startups' },
        { key: 'developers', label: 'Desarrolladores y equipos técnicos' },
    ],
    pet_services: [
        { key: 'dog_owners', label: 'Dueños de perros' },
        { key: 'cat_owners', label: 'Dueños de gatos' },
        { key: 'multi_pet', label: 'Dueños de múltiples mascotas' },
        { key: 'breeders', label: 'Criadores y refugios' },
    ],
    servicios_hogar: [
        { key: 'homeowners', label: 'Propietarios de vivienda' },
        { key: 'renters', label: 'Arrendatarios' },
        { key: 'admins', label: 'Administradores de edificios' },
        { key: 'b2b', label: 'Empresas y oficinas' },
    ],
    fotografia: [
        { key: 'couples', label: 'Novios y parejas' },
        { key: 'families', label: 'Familias' },
        { key: 'businesses', label: 'Empresas y marcas' },
        { key: 'events', label: 'Organizadores de eventos' },
    ],
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
// Fondo sólido oscuro en selects: con color-scheme:dark hace que el popup nativo de
// <option> se renderice oscuro y legible (dark:bg-white/5 translúcido lo dejaba ilegible).
const selectClasses = cn(inputClasses, "appearance-none cursor-pointer dark:bg-neutral-800");

export default function OnboardingPage() {
    const t = useTranslations('onboarding');
    const locale = useLocale();
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
    const [planSlug, setPlanSlug] = useState<PlanSlug>("emprendedor");
    const [cardTokenId, setCardTokenId] = useState<string | null>(null);

    // Protected
    useEffect(() => {
        const token = localStorage.getItem("accessToken");
        if (!token) router.push("/login");
    }, [router]);

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
            if (TIMEZONE_VALUES.includes(str(draft.timezone))) setTimezone(draft.timezone);

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
                audiences, audienceOther, goals, goalOther,
            }));
        } catch { /* storage lleno o no disponible → seguir sin persistir */ }
    }, [draftLoaded, draftKey, step, companyName, website, phone, businessEmail, about,
        instagram, facebook, linkedin, tiktok, industry, subType, orgSize, timezone,
        audiences, audienceOther, goals, goalOther]);

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
                // `about` es requerido: es el campo más impactante para la calidad del
                // agente (alimenta <turn.business> → "¿qué hacen?"). Sin él, el agente
                // no puede describir el negocio desde el día 1.
                return !!companyName.trim() && !!industry && !!orgSize && !!about.trim();
            case 1:
                return audiences.length > 0;
            case 2:
                return goals.length > 0;
            case 3:
                return !!referral;
            case 4:
                // Starter is always valid. Pro/Enterprise require a card
                // token (collected via the MP card form below).
                if (planSlug === "emprendedor" || planSlug === "starter") return true;
                return !!cardTokenId;
            default:
                return false;
        }
    };

    const handleNext = () => {
        if (!canProceed()) return;
        if (step < STEP_KEYS.length - 1) {
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
            // El idioma con el que está usando el dashboard es mejor señal que el huso
            // horario para decidir en qué idioma se siembra el agente y el contenido.
            locale,
            plan: planSlug,
            cardTokenId: planSlug !== "emprendedor" && planSlug !== "starter" ? cardTokenId : undefined,
        };

        try {
            const result = await api.completeOnboarding(data);
            if (!result.success) {
                setError(result.error || t('registrationError'));
                setIsSubmitting(false);
                return;
            }

            // Update tokens & user if returned
            if (result.data) {
                const d = result.data as any;
                if (d.accessToken) localStorage.setItem("accessToken", d.accessToken);
                if (d.refreshToken) localStorage.setItem("refreshToken", d.refreshToken);
                if (d.user) localStorage.setItem("user", JSON.stringify(d.user));
                if (d.verticalConfig) localStorage.setItem("verticalConfig", JSON.stringify(d.verticalConfig));
            }

            // El alta ya está hecha: el borrador no debe sobrevivir (si no, reaparecería
            // relleno la próxima vez que alguien abra /onboarding en este navegador).
            try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* noop */ }

            // Puente cohesivo: en vez de caer al dashboard (que rebota al wizard con un
            // flash), mostramos una transición breve y vamos DIRECTO al setup-wizard.
            // Full page reload para que AuthContext re-lea los tokens nuevos con tenantId.
            setRedirecting(true);
            redirectTimerRef.current = setTimeout(() => { window.location.href = "/admin/setup-wizard"; }, 1400);
            return;
        } catch {
            setError(t('connectionError'));
        }
        setIsSubmitting(false);
    };

    // Puente visual /onboarding → setup-wizard: transición cohesiva antes del reload.
    if (redirecting) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-gradient-to-br dark:from-[#0a0a14] dark:via-[#12122a] dark:to-[#1a0a2e] p-5">
                <div className="text-center relative z-10">
                    <div className="mb-6"><AnimatedLogo height={44} animate showPoweredBy={false} /></div>
                    <div className="w-10 h-10 border-[3px] border-neutral-200 dark:border-white/15 border-t-indigo-500 rounded-full animate-spin mx-auto mb-5" />
                    <h2 className="text-lg font-semibold text-foreground mb-1">{t('bridge.title')}</h2>
                    <p className="text-sm text-muted-foreground">{t('bridge.subtitle')}</p>
                </div>
            </div>
        );
    }

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
                            <h2 className="text-xl font-semibold text-foreground mb-1">{t('step1Title')}</h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {t('step1Subtitle')}
                            </p>

                            {/* Company Name */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('companyName')} <span className="text-rose-500">*</span>
                                </label>
                                <div className="relative">
                                    <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                    <input
                                        type="text"
                                        value={companyName}
                                        onChange={(e) => setCompanyName(e.target.value)}
                                        placeholder={t('companyNamePlaceholder')}
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
                                    {t('about')} <span className="text-rose-500">*</span>
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
                                    {t('socialMedia')}
                                </label>
                                <div className="space-y-2.5">
                                    <div className="relative">
                                        <Instagram size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={instagram}
                                            onChange={(e) => setInstagram(e.target.value)}
                                            placeholder={t('instagramUrl')}
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                    <div className="relative">
                                        <Facebook size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={facebook}
                                            onChange={(e) => setFacebook(e.target.value)}
                                            placeholder={t('facebookUrl')}
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                    <div className="relative">
                                        <Linkedin size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={linkedin}
                                            onChange={(e) => setLinkedin(e.target.value)}
                                            placeholder={t('linkedinUrl')}
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                    <div className="relative">
                                        <TikTokIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                                        <input
                                            type="url"
                                            value={tiktok}
                                            onChange={(e) => setTiktok(e.target.value)}
                                            placeholder={t('tiktokUrl')}
                                            className={inputWithIconClasses}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Industry */}
                            <div className="mb-4">
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('industry')} <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    value={industry}
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
                                        {t('businessType')}
                                    </label>
                                    <select
                                        value={subType}
                                        onChange={(e) => setSubType(e.target.value)}
                                        className={cn(selectClasses, "pr-8")}
                                        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239898b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                                    >
                                        <option value="">{t('select')}</option>
                                        {SUB_TYPES[industry].map((st) => (
                                            <option key={st.key} value={st.key} className="bg-white dark:bg-[#1a1a2e] text-foreground">
                                                {t(`subTypes.${st.key}`)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Org Size */}
                            <div>
                                <label className="block text-[13px] text-muted-foreground mb-1.5 font-medium">
                                    {t('companySize')} <span className="text-rose-500">*</span>
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
                                    {t('timezone')} <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    value={timezone}
                                    onChange={(e) => setTimezone(e.target.value)}
                                    className={cn(selectClasses, "pr-8")}
                                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239898b0' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                                >
                                    {TIMEZONE_GROUPS.map((g) => (
                                        <optgroup key={g.region} label={g.region}>
                                            {g.zones.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                                        </optgroup>
                                    ))}
                                </select>
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
                                        <span className="text-sm text-foreground">{VERTICAL_AUDIENCES[industry] ? t(`verticalAudiences.${industry}.${audience.key}`) : audience.label}</span>
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
                                {t('goalsTitle')}
                            </h2>
                            <p className="text-muted-foreground text-sm mb-6">
                                {t('step3')}
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
                                            {VERTICAL_GOALS[industry] ? t(`verticalGoals.${industry}.${goal.key}`) : goal.label}
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
                                    const requiresCard = slug !== 'emprendedor' && slug !== 'starter';
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
                            {planSlug !== "emprendedor" && planSlug !== "starter" && !cardTokenId && (
                                <div className="mt-5 p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900">
                                    <h3 className="text-sm font-semibold mb-3">{t('cardSectionTitle')}</h3>
                                    <MpCardForm
                                        onToken={(token) => setCardTokenId(token)}
                                        submitLabel={t('saveCard')}
                                    />
                                </div>
                            )}

                            {planSlug !== "emprendedor" && planSlug !== "starter" && cardTokenId && (
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
                                <ChevronLeft size={16} /> {t('back')}
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
        </div>
    );
}
