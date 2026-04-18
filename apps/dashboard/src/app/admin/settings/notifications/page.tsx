"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
    Bell,
    MessageSquare,
    UserCheck,
    Shield,
    CalendarDays,
    Workflow,
    ShoppingCart,
    Settings,
} from "lucide-react";

interface NotificationCategory {
    id: string;
    label: string;
    description: string;
    icon: any;
    iconColor: string;
    enabled: boolean;
}

const defaultCategories: NotificationCategory[] = [
    { id: "chat", label: "New messages", description: "When a client sends a new message", icon: MessageSquare, iconColor: "text-green-500", enabled: true },
    { id: "handoff", label: "Transfers", description: "When a conversation is escalated to an agent", icon: UserCheck, iconColor: "text-blue-500", enabled: true },
    { id: "compliance", label: "Compliance", description: "Solicitudes de opt-out y consentimiento", icon: Shield, iconColor: "text-amber-500", enabled: true },
    { id: "appointments", label: "Citas", description: "Nuevas citas, cancelaciones y recordatorios", icon: CalendarDays, iconColor: "text-purple-500", enabled: true },
    { id: "automation", label: "Automation", description: "Rules executed, flow errors", icon: Workflow, iconColor: "text-indigo-500", enabled: false },
    { id: "orders", label: "Pedidos", description: "Nuevos pedidos y cambios de estado", icon: ShoppingCart, iconColor: "text-emerald-500", enabled: false },
    { id: "system", label: "Sistema", description: "Actualizaciones, mantenimiento y alertas", icon: Settings, iconColor: "text-neutral-500", enabled: true },
];

export default function NotificationsPage() {
    const [categories, setCategories] = useState(defaultCategories);
    const [emailDigest, setEmailDigest] = useState("realtime");
    const [soundEnabled, setSoundEnabled] = useState(true);

    const toggleCategory = (id: string) => {
        setCategories(prev =>
            prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c)
        );
    };

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Notificaciones</h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Configure which notifications you receive
                </p>
            </div>

            {/* General preferences */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900 space-y-5">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Preferencias generales</h2>

                {/* Email digest */}
                <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
                        Resumen por email
                    </label>
                    <select
                        value={emailDigest}
                        onChange={(e) => setEmailDigest(e.target.value)}
                        className="h-10 w-full max-w-xs rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                        <option value="realtime">Tiempo real</option>
                        <option value="hourly">Cada hora</option>
                        <option value="daily">Resumen diario (9:00 AM)</option>
                        <option value="off">Desactivado</option>
                    </select>
                </div>

                {/* Sound */}
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Sonido de notificación</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">Reproducir sonido al recibir notificaciones</div>
                    </div>
                    <button
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        className={cn(
                            "relative h-6 w-12 shrink-0 cursor-pointer rounded-full border-none transition-colors",
                            soundEnabled ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                        )}
                    >
                        <div className={cn(
                            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200",
                            soundEnabled ? "left-[27px]" : "left-[3px]"
                        )} />
                    </button>
                </div>
            </div>

            {/* Categories */}
            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                    Categories
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-5">
                    Toggle notifications by category
                </p>

                <div className="space-y-3">
                    {categories.map((cat) => {
                        const Icon = cat.icon;
                        return (
                            <div
                                key={cat.id}
                                className="flex items-center gap-3.5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-800/50"
                            >
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-neutral-800">
                                    <Icon size={18} className={cat.iconColor} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{cat.label}</div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{cat.description}</div>
                                </div>
                                <button
                                    onClick={() => toggleCategory(cat.id)}
                                    className={cn(
                                        "relative h-6 w-12 shrink-0 cursor-pointer rounded-full border-none transition-colors",
                                        cat.enabled ? "bg-indigo-600" : "bg-neutral-300 dark:bg-neutral-600"
                                    )}
                                >
                                    <div className={cn(
                                        "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-200",
                                        cat.enabled ? "left-[27px]" : "left-[3px]"
                                    )} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Coming soon note */}
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-neutral-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-neutral-400">
                <Bell size={14} className="text-indigo-500 shrink-0" />
                Preferences are saved locally for now. Server persistence coming soon.
            </div>
        </div>
    );
}
