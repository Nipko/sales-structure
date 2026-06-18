"use client";

import React, { Component, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useOnborda } from "onborda";
import type { CardComponentProps } from "onborda";
import { X, ArrowRight, ArrowLeft } from "lucide-react";

/** Flag que el setup-wizard deja al terminar para disparar el tour en /admin. */
export const TOUR_PENDING_KEY = "parallly:tour:pending";

/**
 * Pasos del tour guiado. Bloque A (impactan al agente de chat) primero, Bloque B
 * (valor adicional) después. Targetean items SIEMPRE visibles del sidebar por id
 * (`tour-${labelKey}`); los headers de acordeón existen aunque estén colapsados.
 */
export function useProductTourSteps() {
    const t = useTranslations("productTour");
    return [
        {
            tour: "main",
            steps: [
                // Bloque A — impactan al agente
                { icon: "🤖", title: t("agent.title"), content: t("agent.content"), selector: "#tour-automation", side: "right" as const, showControls: true, pointerPadding: 8, pointerRadius: 12 },
                { icon: "🔌", title: t("channels.title"), content: t("channels.content"), selector: "#tour-channels", side: "right" as const, showControls: true, pointerPadding: 8, pointerRadius: 12 },
                // Bloque B — valor adicional
                { icon: "💬", title: t("inbox.title"), content: t("inbox.content"), selector: "#tour-conversations", side: "right" as const, showControls: true, pointerPadding: 8, pointerRadius: 12 },
                { icon: "📊", title: t("analytics.title"), content: t("analytics.content"), selector: "#tour-analytics", side: "right" as const, showControls: true, pointerPadding: 8, pointerRadius: 12 },
            ],
        },
    ];
}

/** Tarjeta del tour (shadcn-styled). */
export function TourCard({ step, currentStep, totalSteps, nextStep, prevStep, arrow }: CardComponentProps) {
    const t = useTranslations("productTour");
    const { closeOnborda } = useOnborda();
    const isLast = currentStep + 1 >= totalSteps;
    return (
        <div className="max-w-xs rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <span>{step.icon}</span> {step.title}
                </h3>
                <button onClick={() => closeOnborda()} className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer" aria-label={t("close")}>
                    <X size={15} />
                </button>
            </div>
            <div className="text-[13px] text-muted-foreground leading-snug mb-3">{step.content}</div>
            <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{currentStep + 1} / {totalSteps}</span>
                <div className="flex items-center gap-2">
                    {currentStep > 0 && (
                        <button onClick={() => prevStep()} className="px-2 py-1 rounded-lg text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center cursor-pointer" aria-label={t("prev")}>
                            <ArrowLeft size={13} />
                        </button>
                    )}
                    <button
                        onClick={() => (isLast ? closeOnborda() : nextStep())}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1 cursor-pointer"
                    >
                        {isLast ? t("finish") : t("next")} {!isLast && <ArrowRight size={13} />}
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
