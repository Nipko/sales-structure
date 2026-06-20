"use client";

import React, { Component, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useOnborda } from "onborda";
import type { CardComponentProps } from "onborda";
import { X, ArrowRight, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/** Flag que el setup-wizard deja al terminar para disparar el tour en /admin. */
export const TOUR_PENDING_KEY = "parallly:tour:pending";

/**
 * Mapa vertical → labelKey del ítem PERSONALIZADO del sidebar (id `tour-{labelKey}`).
 * Solo las verticales con un ítem gateado por industria en AppSidebar; el resto
 * (automotriz, moda_belleza, servicios_profesionales, finanzas, technology, otro)
 * no tienen herramienta custom en el sidebar → el tour omite ese paso.
 *
 * NOTA: el tour se dispara post-setup-wizard en contexto tenant_admin, que tiene
 * canEditPipeline + canHandleConversations, así que estos ítems siempre se renderizan.
 * Si en el futuro se agrega un ítem con `verticals:` en AppSidebar, actualizar este mapa.
 */
const VERTICAL_TOOL_LABELKEY: Record<string, string> = {
    turismo: "properties",
    inmobiliaria: "listings",
    restaurantes: "menu",
    gimnasios: "memberships",
    education: "courses",
    seguros: "insurance",
    servicios_hogar: "serviceRequests",
    veterinaria: "pets",
    salud: "treatmentPlans",
    pet_services: "pets",
    fotografia: "photoSessions",
    retail: "orders",
};

/**
 * Pasos del tour guiado. Bloque A (impactan al agente de chat) primero, Bloque B
 * (valor adicional) después. Targetean items SIEMPRE visibles del sidebar por id
 * (`tour-${labelKey}`); los headers de acordeón existen aunque estén colapsados.
 */
export function useProductTourSteps() {
    const t = useTranslations("productTour");
    const tNav = useTranslations("nav");
    const { verticalConfig } = useAuth();
    const common = { side: "right" as const, showControls: true, pointerPadding: 8, pointerRadius: 12 };

    const steps: any[] = [
        // Bloque A — impactan al agente
        { icon: "🤖", title: t("agent.title"), content: t("agent.content"), selector: "#tour-automation", ...common },
        { icon: "🔌", title: t("channels.title"), content: t("channels.content"), selector: "#tour-channels", ...common },
    ];

    // Paso vertical: ilumina la herramienta personalizada del rubro (si la vertical la tiene).
    // El selector apunta al ítem del sidebar gateado por industria (siempre presente para
    // esa vertical); si la vertical no tiene tool custom, no se agrega el paso.
    const toolKey = VERTICAL_TOOL_LABELKEY[verticalConfig?.industry || ""];
    if (toolKey) {
        steps.push({
            icon: "🧰",
            title: t("verticalTool.title"),
            content: t("verticalTool.content", { tool: tNav(`items.${toolKey}`) }),
            selector: `#tour-${toolKey}`,
            ...common,
        });
    }

    // Bloque B — valor adicional
    steps.push(
        { icon: "💬", title: t("inbox.title"), content: t("inbox.content"), selector: "#tour-conversations", ...common },
        { icon: "📊", title: t("analytics.title"), content: t("analytics.content"), selector: "#tour-analytics", ...common },
    );

    return [{ tour: "main", steps }];
}

/** Tarjeta del tour (shadcn-styled). */
export function TourCard({ step, currentStep, totalSteps, nextStep, prevStep, arrow }: CardComponentProps) {
    const t = useTranslations("productTour");
    const { closeOnborda } = useOnborda();
    const isLast = currentStep + 1 >= totalSteps;

    // Fix de posición: Onborda calcula la posición de la tarjeta ANTES de que termine su
    // scroll suave (y no escucha el evento 'scroll'), dejándola fuera de pantalla cuando el
    // target del sidebar estaba scrolleado. Llevamos el target a la vista al instante y
    // disparamos 'resize' (que Onborda SÍ escucha → updatePointerPosition) para recalcular.
    const selector = (step as any)?.selector as string | undefined;
    useEffect(() => {
        if (!selector) return;
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el) el.scrollIntoView({ block: "center", behavior: "auto" });
        const raf = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        const tm = setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
        return () => { cancelAnimationFrame(raf); clearTimeout(tm); };
    }, [currentStep, selector]);

    return (
        <div className="w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl p-5">
            {/* Header */}
            <div className="flex items-start gap-3 mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center text-xl shrink-0">
                    {step.icon}
                </div>
                <h3 className="flex-1 text-[15px] font-semibold text-foreground leading-tight pt-1.5">{step.title}</h3>
                <button onClick={() => closeOnborda()} className="shrink-0 -mt-1 -mr-1 p-1 text-muted-foreground hover:text-foreground cursor-pointer" aria-label={t("close")}>
                    <X size={16} />
                </button>
            </div>

            {/* Content */}
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{step.content}</p>

            {/* Progress dots */}
            <div className="flex items-center gap-1.5 mb-4" aria-hidden>
                {Array.from({ length: totalSteps }).map((_, i) => (
                    <span
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${
                            i === currentStep ? "w-5 bg-indigo-500"
                                : i < currentStep ? "w-1.5 bg-indigo-400/60"
                                : "w-1.5 bg-neutral-200 dark:bg-white/15"
                        }`}
                    />
                ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground tabular-nums">{currentStep + 1} / {totalSteps}</span>
                <div className="flex items-center gap-2">
                    {currentStep > 0 && (
                        <button onClick={() => prevStep()} className="px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-neutral-100 dark:hover:bg-white/5 inline-flex items-center gap-1 cursor-pointer transition-colors">
                            <ArrowLeft size={14} /> {t("prev")}
                        </button>
                    )}
                    <button
                        onClick={() => (isLast ? closeOnborda() : nextStep())}
                        className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                    >
                        {isLast ? t("finish") : t("next")} {!isLast && <ArrowRight size={14} />}
                    </button>
                </div>
            </div>
            {arrow}
        </div>
    );
}

/** Evento global para reiniciar el tour desde cualquier parte (ej: HelpAssistant). */
export const TOUR_RESTART_EVENT = "parallly:start-tour";

/** Dispara el tour cuando el usuario llega a /admin tras completar el setup-wizard. */
export function TourLauncher() {
    const { startOnborda } = useOnborda();
    useEffect(() => {
        try {
            if (localStorage.getItem(TOUR_PENDING_KEY) === "true") {
                localStorage.removeItem(TOUR_PENDING_KEY);
                // Pequeño delay para asegurar que el sidebar (targets) esté montado.
                const tm = setTimeout(() => { try { startOnborda("main"); } catch { /* noop */ } }, 800);
                return () => clearTimeout(tm);
            }
        } catch { /* localStorage no disponible */ }
    }, [startOnborda]);

    // Permite reiniciar el tour bajo demanda (HelpAssistant dispara este evento).
    // Vive dentro de <Onborda>, así que useOnborda es seguro aquí.
    useEffect(() => {
        const handler = () => { try { startOnborda("main"); } catch { /* noop */ } };
        window.addEventListener(TOUR_RESTART_EVENT, handler);
        return () => window.removeEventListener(TOUR_RESTART_EVENT, handler);
    }, [startOnborda]);

    return null;
}

/**
 * Aísla fallas del tour: si Onborda lanza en render, cae a renderizar el contenido
 * SIN el tour en vez de romper todo el dashboard (white-screen).
 */
export class TourBoundary extends Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
    constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
        super(props);
        this.state = { failed: false };
    }
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(err: unknown) {
        // eslint-disable-next-line no-console
        console.error("[ProductTour] disabled — render error in Onborda:", err);
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}
