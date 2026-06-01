"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Sparkles, FlaskConical, ChevronLeft, Check, ArrowRight } from "lucide-react";
import WhatsAppEmbeddedSignup from "./WhatsAppEmbeddedSignup";

type RouteId = "coexistence" | "new" | "sandbox";

interface WhatsAppConnectPanelProps {
    tenantId: string;
    onConnected?: (data: { displayPhoneNumber?: string }) => void;
    variant?: "page" | "onboarding";
}

const ROUTES: { id: RouteId; mode: "standard" | "coexistence"; icon: typeof Layers; color: string; recommended?: boolean }[] = [
    { id: "coexistence", mode: "coexistence", icon: Layers, color: "#1877F2", recommended: true },
    { id: "new", mode: "standard", icon: Sparkles, color: "#25D366" },
    { id: "sandbox", mode: "standard", icon: FlaskConical, color: "#8b5cf6" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function WhatsAppConnectPanel({ tenantId, onConnected }: WhatsAppConnectPanelProps) {
    const tw = useTranslations("channels.whatsapp");
    const t = useTranslations("setupWizard.connect");
    const [route, setRoute] = useState<RouteId | null>(null);
    const [connected, setConnected] = useState<{ displayPhoneNumber?: string } | null>(null);
    const [error, setError] = useState("");

    if (connected) {
        return (
            <div className="rounded-xl border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-5 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center mb-3">
                    <Check size={24} />
                </div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t("connected")}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400/80 mt-1">
                    {t("connectedDesc", { phone: connected.displayPhoneNumber || "" })}
                </p>
            </div>
        );
    }

    const activeRoute = ROUTES.find((r) => r.id === route);

    if (activeRoute) {
        return (
            <div>
                <button
                    onClick={() => { setRoute(null); setError(""); }}
                    className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground mb-4 cursor-pointer"
                >
                    <ChevronLeft size={14} /> {t("back")}
                </button>
                {error && (
                    <div className="mb-3 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                        {error}
                    </div>
                )}
                {(activeRoute.id === "coexistence" || activeRoute.id === "sandbox") && (
                    <p className="mb-3 text-xs text-muted-foreground">
                        {activeRoute.id === "coexistence" ? t("coexistenceHint") : t("sandboxHint")}
                    </p>
                )}
                <WhatsAppEmbeddedSignup
                    tenantId={tenantId}
                    mode={activeRoute.mode}
                    onSuccess={(data) => {
                        setConnected({ displayPhoneNumber: data.displayPhoneNumber });
                        onConnected?.({ displayPhoneNumber: data.displayPhoneNumber });
                    }}
                    onError={(e) => setError(e)}
                />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {ROUTES.map((r) => {
                const Icon = r.icon;
                return (
                    <button
                        key={r.id}
                        onClick={() => setRoute(r.id)}
                        className="w-full flex items-center gap-4 p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] hover:border-indigo-500/40 text-left transition-all relative cursor-pointer"
                    >
                        {r.recommended && (
                            <span className="absolute -top-2 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500 text-white">
                                {t("recommended")}
                            </span>
                        )}
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: r.color }}>
                            <Icon size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{tw(`route${cap(r.id)}Title`)}</p>
                            <p className="text-[12px] text-muted-foreground leading-snug">{tw(`route${cap(r.id)}Short`)}</p>
                        </div>
                        <ArrowRight size={16} className="text-muted-foreground shrink-0" />
                    </button>
                );
            })}
        </div>
    );
}
