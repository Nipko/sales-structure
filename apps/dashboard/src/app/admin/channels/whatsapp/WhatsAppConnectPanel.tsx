"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Sparkles, ArrowRightLeft, ChevronLeft, Check, ArrowRight, AlertTriangle, MessageSquare } from "lucide-react";
import WhatsAppEmbeddedSignup, { isKnownWhatsAppWarning } from "./WhatsAppEmbeddedSignup";
import WhatsAppPrerequisites from "./WhatsAppPrerequisites";
import WhatsAppRouteBrief from "./WhatsAppRouteBrief";
import {
    WHATSAPP_CONNECT_ROUTES,
    getWhatsAppConnectRoute,
    whatsAppRouteKey,
    type WhatsAppConnectRouteId,
} from "./whatsapp-connect-routes";
import { guidedTourAnchorId } from "@/lib/guided-tours";

export interface WhatsAppConnectedPayload {
    displayPhoneNumber?: string;
    warnings?: string[];
}

interface WhatsAppConnectPanelProps {
    tenantId: string;
    onConnected?: (data: WhatsAppConnectedPayload) => void;
    /** Fired when the person acknowledges the connected state (wizard advance). */
    onAcknowledged?: () => void;
    variant?: "page" | "onboarding";
}

const ROUTE_ICONS: Record<WhatsAppConnectRouteId, typeof Layers> = {
    coexistence: Layers,
    new: Sparkles,
    migration: ArrowRightLeft,
};

export default function WhatsAppConnectPanel({ tenantId, onConnected, onAcknowledged }: WhatsAppConnectPanelProps) {
    const tw = useTranslations("channels.whatsapp");
    const twn = useTranslations("channels.whatsapp.warnings");
    const t = useTranslations("setupWizard.connect");
    const [route, setRoute] = useState<WhatsAppConnectRouteId | null>(null);
    const [prereqsOk, setPrereqsOk] = useState(false);
    const [connected, setConnected] = useState<WhatsAppConnectedPayload | null>(null);

    if (connected) {
        const warnings = connected.warnings ?? [];
        const digits = (connected.displayPhoneNumber || "").replace(/[^0-9]/g, "");
        return (
            <div className="space-y-3">
                {warnings.length > 0 ? (
                    <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-5">
                        <div className="flex items-start gap-2.5">
                            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{twn("title")}</p>
                                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{twn("subtitle")}</p>
                                <ul className="mt-3 space-y-2">
                                    {warnings.map((warning) => (
                                        <li key={warning} className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                                            • {isKnownWhatsAppWarning(warning) ? twn(`codes.${warning}`) : warning}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-5 text-center">
                        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center mb-3">
                            <Check size={24} />
                        </div>
                        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t("connected")}</p>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400/80 mt-1">
                            {t("connectedDesc", { phone: connected.displayPhoneNumber || "" })}
                        </p>
                    </div>
                )}

                {/* El cierre del bucle: mandarse un mensaje y verlo responder. Antes el
                    asistente avanzaba solo a los 1,4 s y esta prueba nunca ocurría. */}
                <div
                    id={guidedTourAnchorId("whatsapp-test")}
                    className="rounded-xl border border-emerald-200 dark:border-emerald-500/25 bg-white dark:bg-white/[0.04] p-4 flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                    <div className="w-9 h-9 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0">
                        <MessageSquare size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{tw("testAgentTitle")}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{tw("testAgentDesc", { number: connected.displayPhoneNumber || "" })}</p>
                    </div>
                    {digits && (
                        <a
                            href={`https://wa.me/${digits}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                        >
                            {tw("testAgentCta")} <ArrowRight size={14} />
                        </a>
                    )}
                </div>

                {onAcknowledged && (
                    <button
                        type="button"
                        onClick={onAcknowledged}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 cursor-pointer"
                    >
                        {t("continue")} <ArrowRight size={16} />
                    </button>
                )}
            </div>
        );
    }

    const activeRoute = getWhatsAppConnectRoute(route);

    if (activeRoute) {
        return (
            <div>
                <button
                    onClick={() => setRoute(null)}
                    className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground mb-4 cursor-pointer"
                >
                    <ChevronLeft size={14} /> {t("back")}
                </button>

                {/* Pasos, requisitos y avisos ANTES del botón: es donde se decide si
                    la persona tiene lo necesario, no dentro de la ventana de Meta. */}
                <WhatsAppRouteBrief route={activeRoute} compact />

                <div className="mt-4">
                    <WhatsAppEmbeddedSignup
                        tenantId={tenantId}
                        mode={activeRoute.mode}
                        onSuccess={(data) => {
                            const payload = {
                                displayPhoneNumber: data.displayPhoneNumber,
                                warnings: data.warnings ?? [],
                            };
                            setConnected(payload);
                            onConnected?.(payload);
                        }}
                        onError={() => { /* el propio componente muestra el error con su próximo paso */ }}
                    />
                </div>
            </div>
        );
    }

    // Gate suave: confirmar prerrequisitos antes de ver las rutas (reduce abandono en el popup de Meta).
    if (!prereqsOk) {
        return <WhatsAppPrerequisites onContinue={() => setPrereqsOk(true)} />;
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
            <div id={guidedTourAnchorId("whatsapp-routes")} className="space-y-3">
            {WHATSAPP_CONNECT_ROUTES.map((r) => {
                const Icon = ROUTE_ICONS[r.id];
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
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: r.accent.solid }}>
                            <Icon size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{tw(whatsAppRouteKey(r, "Title"))}</p>
                            <p className="text-[12px] text-muted-foreground leading-snug">{tw(whatsAppRouteKey(r, "Short"))}</p>
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
