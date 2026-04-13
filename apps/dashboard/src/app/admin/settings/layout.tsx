"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
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
    type LucideIcon,
} from "lucide-react";

interface SettingsNavItem {
    label: string;
    href: string;
    icon: LucideIcon;
}

interface SettingsNavSection {
    title: string;
    items: SettingsNavItem[];
    adminOnly?: boolean;
}

const settingsSections: SettingsNavSection[] = [
    {
        title: "Mi Cuenta",
        items: [
            { label: "Perfil", href: "/admin/settings/profile", icon: User },
            { label: "Seguridad", href: "/admin/settings/security", icon: Shield },
            { label: "Notificaciones", href: "/admin/settings/notifications", icon: Bell },
            { label: "Apariencia", href: "/admin/settings/appearance", icon: Palette },
        ],
    },
    {
        title: "Empresa",
        adminOnly: true,
        items: [
            { label: "General", href: "/admin/settings/company", icon: Building2 },
            { label: "Localización", href: "/admin/settings/localization", icon: Globe },
            { label: "Horarios", href: "/admin/settings/business-hours", icon: Clock },
        ],
    },
    {
        title: "Herramientas",
        adminOnly: true,
        items: [
            { label: "Atributos personalizados", href: "/admin/settings/custom-attributes", icon: Database },
            { label: "Macros", href: "/admin/settings/macros", icon: Zap },
            { label: "Formulario pre-chat", href: "/admin/settings/prechat", icon: MessageSquare },
            { label: "Plantillas de email", href: "/admin/settings/email-templates", icon: Mail },
            { label: "Banco de medios", href: "/admin/settings/media", icon: Image },
        ],
    },
    {
        title: "Canales",
        adminOnly: true,
        items: [
            { label: "Configuración", href: "/admin/settings/channels", icon: Phone },
        ],
    },
    {
        title: "IA y Modelos",
        adminOnly: true,
        items: [
            { label: "Proveedores LLM", href: "/admin/settings/ai-providers", icon: Brain },
            { label: "Configuración IA", href: "/admin/settings/ai-config", icon: SlidersHorizontal },
        ],
    },
    {
        title: "Plataforma",
        adminOnly: true,
        items: [
            { label: "Avanzado", href: "/admin/settings/platform", icon: Settings },
        ],
    },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user } = useAuth();
    const isAdmin = user?.role === "super_admin" || user?.role === "tenant_admin";

    const isActive = (href: string) => pathname === href;

    // On the hub page (/admin/settings), render children directly without sidebar
    if (pathname === "/admin/settings") {
        return <>{children}</>;
    }

    return (
        <div className="flex gap-6 -m-6">
            {/* Settings sidebar */}
            <aside className="w-[240px] shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 h-[calc(100vh-3.5rem)] overflow-y-auto sticky top-0">
                <div className="p-4 pb-2">
                    <Link
                        href="/admin/settings"
                        className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                    >
                        &larr; Configuración
                    </Link>
                </div>

                <nav className="px-2 pb-6 space-y-5">
                    {settingsSections.map((section) => {
                        if (section.adminOnly && !isAdmin) return null;
                        return (
                            <div key={section.title}>
                                <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                                    {section.title}
                                </p>
                                <ul className="space-y-0.5">
                                    {section.items.map((item) => {
                                        const active = isActive(item.href);
                                        const Icon = item.icon;
                                        return (
                                            <li key={item.href}>
                                                <Link
                                                    href={item.href}
                                                    className={cn(
                                                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                                                        active
                                                            ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                                                            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                                                    )}
                                                >
                                                    <Icon size={16} className="shrink-0" />
                                                    <span>{item.label}</span>
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </nav>
            </aside>

            {/* Settings content */}
            <div className="flex-1 min-w-0 py-6 pr-6">
                {children}
            </div>
        </div>
    );
}
