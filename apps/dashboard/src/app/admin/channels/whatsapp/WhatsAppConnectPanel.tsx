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
    { id: "coexistence", mode: "coexistence", icon: Layers, color: "#25D366", recommended: true },
    { id: "new", mode: "standard", icon: Sparkles, color: "#128C7E" },
    { id: "sandbox", mode: "standard", icon: FlaskConical, color: "#6b7280" },
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
        <div>
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-neutral-200 dark:border-white/10">
                <div className="w-11 h-11 rounded-xl bg-[#25D366] flex items-center justify-center shrink-0 shadow-[0_4px_14px_rgba(37,211,102,0.35)]">
                    <WhatsAppGlyph className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{t("whatsappBrandTitle")}</p>
                    <p className="text-[12px] text-muted-foreground">{t("officialMeta")}</p>
                </div>
            </div>
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
        </div>
    );
}

function WhatsAppGlyph({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
        </svg>
    );
}
