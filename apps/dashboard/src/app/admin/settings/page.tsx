"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
    User,
    Shield,
    Bell,
    Palette,
    Building2,
    Globe,
    Clock,
    Database,
    Zap,
    MessageSquare,
    Mail,
    Image,
    Brain,
    SlidersHorizontal,
    Phone,
    Settings,
    ArrowRight,
    type LucideIcon,
} from "lucide-react";

interface SettingsCard {
    label: string;
    description: string;
    href: string;
    icon: LucideIcon;
    iconColor: string;
    iconBg: string;
}

interface SettingsSection {
    title: string;
    description: string;
    cards: SettingsCard[];
    adminOnly?: boolean;
}

const sections: SettingsSection[] = [
    {
        title: "Mi Cuenta",
        description: "Tu perfil, seguridad y preferencias personales",
        cards: [
            { label: "Perfil", description: "Nombre, email, avatar y datos personales", href: "/admin/settings/profile", icon: User, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
            { label: "Seguridad", description: "Contraseña, autenticación de dos factores", href: "/admin/settings/security", icon: Shield, iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
            { label: "Notificaciones", description: "Configura alertas por categoría y canal", href: "/admin/settings/notifications", icon: Bell, iconColor: "text-rose-500", iconBg: "bg-rose-500/10" },
            { label: "Apariencia", description: "Tema claro, oscuro o automático", href: "/admin/settings/appearance", icon: Palette, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
        ],
    },
    {
        title: "Empresa",
        description: "Configuración del workspace y tu organización",
        adminOnly: true,
        cards: [
            { label: "General", description: "Nombre, industria, logo y datos de la empresa", href: "/admin/settings/company", icon: Building2, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
            { label: "Localización", description: "Zona horaria, moneda, formato de fecha e idioma", href: "/admin/settings/localization", icon: Globe, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
            { label: "Horarios de negocio", description: "Horarios por día, festivos y mensaje fuera de horario", href: "/admin/settings/business-hours", icon: Clock, iconColor: "text-sky-500", iconBg: "bg-sky-500/10" },
        ],
    },
    {
        title: "Herramientas",
        description: "Atributos, macros, formularios y plantillas",
        adminOnly: true,
        cards: [
            { label: "Atributos personalizados", description: "Campos dinámicos para contactos y leads", href: "/admin/settings/custom-attributes", icon: Database, iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
            { label: "Macros", description: "Secuencias de acciones rápidas para agentes", href: "/admin/settings/macros", icon: Zap, iconColor: "text-orange-500", iconBg: "bg-orange-500/10" },
            { label: "Formulario pre-chat", description: "Campos solicitados antes de iniciar un chat", href: "/admin/settings/prechat", icon: MessageSquare, iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
            { label: "Plantillas de email", description: "Emails de confirmación, recordatorios y más", href: "/admin/settings/email-templates", icon: Mail, iconColor: "text-purple-500", iconBg: "bg-purple-500/10" },
            { label: "Banco de medios", description: "Imágenes, logo de empresa y galería", href: "/admin/settings/media", icon: Image, iconColor: "text-pink-500", iconBg: "bg-pink-500/10" },
        ],
    },
    {
        title: "Canales",
        description: "Configuración de WhatsApp, Instagram, Messenger y Telegram",
        adminOnly: true,
        cards: [
            { label: "Configuración de canales", description: "API keys y credenciales de cada canal", href: "/admin/settings/channels", icon: Phone, iconColor: "text-green-500", iconBg: "bg-green-500/10" },
        ],
    },
    {
        title: "IA y Modelos",
        description: "Proveedores de lenguaje y configuración del router IA",
        adminOnly: true,
        cards: [
            { label: "Proveedores LLM", description: "API keys de OpenAI, Anthropic, Google AI y más", href: "/admin/settings/ai-providers", icon: Brain, iconColor: "text-indigo-500", iconBg: "bg-indigo-500/10" },
            { label: "Configuración IA", description: "Modelo por defecto, temperatura y tokens", href: "/admin/settings/ai-config", icon: SlidersHorizontal, iconColor: "text-violet-500", iconBg: "bg-violet-500/10" },
        ],
    },
    {
        title: "Plataforma",
        description: "Configuración avanzada de la plataforma",
        adminOnly: true,
        cards: [
            { label: "Avanzado", description: "Nombre de plataforma, límites y features", href: "/admin/settings/platform", icon: Settings, iconColor: "text-neutral-500", iconBg: "bg-neutral-500/10" },
        ],
    },
];

export default function SettingsHub() {
    const router = useRouter();
    const { user } = useAuth();
    const isAdmin = user?.role === "super_admin" || user?.role === "tenant_admin";

    return (
        <div className="space-y-8 max-w-5xl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                    Configuración
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Gestiona tu cuenta, empresa, canales y herramientas
                </p>
            </div>

            {/* Sections */}
            {sections.map((section) => {
                if (section.adminOnly && !isAdmin) return null;
                return (
                    <div key={section.title}>
                        <div className="mb-3">
                            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                                {section.title}
                            </h2>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                {section.description}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            {section.cards.map((card) => {
                                const Icon = card.icon;
                                return (
                                    <button
                                        key={card.href}
                                        onClick={() => router.push(card.href)}
                                        className="group flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-white px-5 py-4 text-left transition-all hover:border-indigo-400 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-500"
                                    >
                                        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", card.iconBg)}>
                                            <Icon size={20} className={card.iconColor} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                                {card.label}
                                            </div>
                                            <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1">
                                                {card.description}
                                            </div>
                                        </div>
                                        <ArrowRight size={16} className="shrink-0 text-neutral-300 dark:text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
