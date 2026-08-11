"use client";

import React, { Component, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useOnborda } from "onborda";
import type { CardComponentProps } from "onborda";
import { X, ArrowRight, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { resolveNavigationDisplayLabel } from "@/lib/navigation-contract";
import {
    PRODUCT_TOUR_PENDING_KEY,
    PRODUCT_TOUR_PREPARE_EVENT,
    PRODUCT_TOUR_RESTART_EVENT,
    PRODUCT_TOUR_TARGETS,
    canRunProductTourAtWidth,
    getProductTourSelector,
} from "@/lib/product-tour-contract";
import { resolveVerticalDashboard } from "@/lib/vertical-dashboard-resolver";

/** Flag que el setup-wizard deja al terminar para disparar el tour en /admin. */
export const TOUR_PENDING_KEY = PRODUCT_TOUR_PENDING_KEY;

/**
 * Pasos del tour guiado. Bloque A (impactan al agente de chat) primero, Bloque B
 * (valor adicional) después. Targetean items SIEMPRE visibles del sidebar por id
 * (`tour-${labelKey}`); los headers de acordeón existen aunque estén colapsados.
 */
export function useProductTourSteps() {
    const t = useTranslations("productTour");
    const tNav = useTranslations("nav");
    const locale = useLocale();
    const { verticalConfig } = useAuth();
    const common = { side: "right" as const, showControls: true, pointerPadding: 8, pointerRadius: 12 };

    const steps: any[] = [
        // Bloque A — impactan al agente
        { icon: "🤖", title: t("agent.title"), content: t("agent.content"), selector: getProductTourSelector(PRODUCT_TOUR_TARGETS.agent), ...common },
        { icon: "🔌", title: t("channels.title"), content: t("channels.content"), selector: getProductTourSelector(PRODUCT_TOUR_TARGETS.channels), ...common },
    ];

    // Paso vertical: usa la misma proyección capability/subtype-aware del sidebar.
    const toolKey = resolveVerticalDashboard(verticalConfig).primaryTourItem;
    if (toolKey) {
        const toolLabel = resolveNavigationDisplayLabel(
            toolKey,
            tNav(`items.${toolKey}`),
            locale,
            verticalConfig?.sidebar?.labelOverrides,
        );
        steps.push({
            icon: "🧰",
            title: t("verticalTool.title"),
            content: t("verticalTool.content", { tool: toolLabel }),
            selector: getProductTourSelector(toolKey),
            ...common,
        });
    }

    // Bloque B — valor adicional
    steps.push(
        { icon: "💬", title: t("inbox.title"), content: t("inbox.content"), selector: getProductTourSelector(PRODUCT_TOUR_TARGETS.inbox), ...common },
        { icon: "📊", title: tNav("items.analytics"), content: t("analytics.content"), selector: getProductTourSelector(PRODUCT_TOUR_TARGETS.analytics), ...common },
    );

    return [{ tour: "main", steps }];
}

/** Tarjeta del tour (shadcn-styled). */
export function TourCard({ step, currentStep, totalSteps, nextStep, prevStep, arrow }: CardComponentProps) {
    const t = useTranslations("productTour");
    const { closeOnborda } = useOnborda();
    const isLast = currentStep + 1 >= totalSteps;
    const cardRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    // Onborda supplies the visual spotlight, while the custom card owns the
    // dialog semantics. Keep keyboard focus inside the tour and restore it to a
    // stable shell target when the tour closes.
    useEffect(() => {
        const activeElement = document.activeElement;
        restoreFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
        const frame = requestAnimationFrame(() => titleRef.current?.focus());

        return () => {
            cancelAnimationFrame(frame);
            const previous = restoreFocusRef.current;
            const previousIsUsable = previous
                && previous !== document.body
                && previous !== document.documentElement
                && previous.isConnected
                && previous.getClientRects().length > 0;
            const fallback = document.querySelector<HTMLElement>("#main-content");
            requestAnimationFrame(() => {
                if (previousIsUsable) previous.focus();
                else fallback?.focus();
            });
        };
    }, []);

    const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeOnborda();
            return;
        }

        if (event.key !== "Tab") return;
        const root = cardRef.current;
        if (!root) return;
        const focusable = Array.from(root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((element) => element.getClientRects().length > 0);

        if (focusable.length === 0) {
            event.preventDefault();
            root.focus();
            return;
        }

        const active = document.activeElement;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (active === titleRef.current || active === root || active === first || !root.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

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
        <div
            ref={cardRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-tour-title"
            aria-describedby="product-tour-content"
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl p-5 outline-none"
        >
            {/* Header */}
            <div className="flex items-start gap-3 mb-2.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center text-xl shrink-0">
                    {step.icon}
                </div>
                <h3
                    ref={titleRef}
                    id="product-tour-title"
                    tabIndex={-1}
                    className="flex-1 text-[15px] font-semibold text-foreground leading-tight pt-1.5 outline-none"
                >
                    {step.title}
                </h3>
                <button onClick={() => closeOnborda()} className="shrink-0 -mt-1 -mr-1 p-1 text-muted-foreground hover:text-foreground cursor-pointer" aria-label={t("close")}>
                    <X size={16} />
                </button>
            </div>

            {/* Content */}
            <p id="product-tour-content" className="text-sm text-muted-foreground leading-relaxed mb-4">{step.content}</p>

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
export const TOUR_RESTART_EVENT = PRODUCT_TOUR_RESTART_EVENT;

/** Dispara el tour cuando el usuario llega a /admin tras completar el setup-wizard. */
export function TourLauncher() {
    const { startOnborda } = useOnborda();
    const { canEditAgent, canManageChannels } = useRole();
    const canLaunchTour = canEditAgent && canManageChannels;

    useEffect(() => {
        if (!canLaunchTour) return;
        const desktop = window.matchMedia("(min-width: 768px)");
        let timer: number | null = null;

        const startPendingTour = () => {
            if (!canRunProductTourAtWidth(window.innerWidth)) return;
            try {
                if (localStorage.getItem(TOUR_PENDING_KEY) !== "true") return;
                localStorage.removeItem(TOUR_PENDING_KEY);
                window.dispatchEvent(new Event(PRODUCT_TOUR_PREPARE_EVENT));
                // React first reveals collapsed sections; Onborda then measures real targets.
                timer = window.setTimeout(() => {
                    try { startOnborda("main"); } catch { /* optional enhancement */ }
                }, 350);
            } catch {
                // The tour stays optional when storage is unavailable.
            }
        };

        startPendingTour();
        const onViewportChange = (event: MediaQueryListEvent) => {
            if (event.matches) startPendingTour();
        };
        desktop.addEventListener("change", onViewportChange);
        return () => {
            desktop.removeEventListener("change", onViewportChange);
            if (timer !== null) window.clearTimeout(timer);
        };
    }, [canLaunchTour, startOnborda]);

    // Permite reiniciar el tour bajo demanda (HelpAssistant dispara este evento).
    // Vive dentro de <Onborda>, así que useOnborda es seguro aquí.
    useEffect(() => {
        let timer: number | null = null;
        const handler = () => {
            if (!canLaunchTour || !canRunProductTourAtWidth(window.innerWidth)) return;
            window.dispatchEvent(new Event(PRODUCT_TOUR_PREPARE_EVENT));
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                try { startOnborda("main"); } catch { /* optional enhancement */ }
            }, 350);
        };
        window.addEventListener(TOUR_RESTART_EVENT, handler);
        return () => {
            window.removeEventListener(TOUR_RESTART_EVENT, handler);
            if (timer !== null) window.clearTimeout(timer);
        };
    }, [canLaunchTour, startOnborda]);

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
        console.error("[ProductTour] disabled — render error in Onborda:", err);
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}
