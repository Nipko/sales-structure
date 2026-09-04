"use client";

import React, {
    Component,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Onborda, OnbordaProvider, useOnborda } from "onborda";
import type { CardComponentProps, Step } from "onborda";
import { X, ArrowRight, ArrowLeft, Compass } from "lucide-react";
import {
    GUIDED_TOUR_IDS,
    GUIDED_TOUR_START_EVENT,
    canRoleRunGuidedTour,
    getGuidedTour,
    isGuidedTourId,
    type GuidedTourId,
} from "@parallext/shared";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import {
    buildGuidedTourSteps,
    getGuidedTourStepDefinitions,
    guidedTourEntryRoute,
    planGuidedTourRun,
    shouldRunGuidedTourInPlace,
    type GuidedTourContext as GuidedTourStepContext,
    type GuidedTourRunPlan,
} from "@/lib/guided-tours";
import { resolveNavigationDisplayLabel } from "@/lib/navigation-contract";
import {
    PRODUCT_TOUR_PENDING_KEY,
    PRODUCT_TOUR_CLOSED_EVENT,
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
 * Contexto de los recorridos guiados ("Mostrarme dónde").
 *
 * Los pasos de varios recorridos apuntan al editor de UN agente concreto
 * (`/admin/agent/{agentId}`). El id llega en el evento que dispara la barra de
 * contexto o Assist, así que el runner lo deja acá ANTES de arrancar y las
 * fábricas de pasos lo leen para resolver la ruta.
 */
interface GuidedTourRuntimeValue {
    context: GuidedTourStepContext;
    setContext: (next: GuidedTourStepContext) => void;
    /**
     * Qué pasos entran REALMENTE en esta corrida. Onborda no reintenta: cuando
     * un selector no existe deja el anillo donde estaba y tapa la pantalla con
     * su capa, así que los pasos imposibles se descartan ANTES de arrancar.
     */
    plan: GuidedTourRunPlan | null;
    setPlan: (next: GuidedTourRunPlan | null) => void;
}

const GuidedTourRuntimeContext = createContext<GuidedTourRuntimeValue>({
    context: {},
    setContext: () => { /* sin provider los recorridos guiados quedan sin agente */ },
    plan: null,
    setPlan: () => { /* sin provider se muestran todos los pasos declarados */ },
});

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
    const [context, setContext] = useState<GuidedTourStepContext>({});
    const [plan, setPlan] = useState<GuidedTourRunPlan | null>(null);
    const value = useMemo<GuidedTourRuntimeValue>(
        () => ({ context, setContext, plan, setPlan }),
        [context, plan],
    );
    return <GuidedTourRuntimeContext.Provider value={value}>{children}</GuidedTourRuntimeContext.Provider>;
}

/** Qué capacidad del rol exige cada recorrido, además del `minRole` del contrato. */
type GuidedTourCapability =
    | "canManageChannels"
    | "canEditAgent"
    | "canEditKnowledge"
    | "canManageSettings"
    | "canManageUsers"
    | "canHandleConversations";

const GUIDED_TOUR_CAPABILITY: Record<GuidedTourId, GuidedTourCapability | null> = {
    connect_channel: "canManageChannels",
    assign_agent_channel: "canEditAgent",
    agent_handoff_rules: "canEditAgent",
    human_handoff_route: "canManageUsers",
    business_identity: "canManageSettings",
    knowledge_base: "canEditKnowledge",
    appointments_setup: "canManageSettings",
    business_hours: "canManageSettings",
    run_agent_tests: "canEditAgent",
    agent_quality_center: null,
    home_first_steps: null,
    first_channel_whatsapp: "canManageChannels",
    resume_setup_wizard: "canEditAgent",
    help_system: null,
    inbox_first_conversation: "canHandleConversations",
};

const GUIDED_TOUR_ANCHOR_TIMEOUT_MS = 8_000;
/**
 * Cada cuánto se comprueba que el paso en curso siga teniendo a qué apuntar, y
 * cuántas comprobaciones seguidas en falso hacen falta para actuar (4 s). La
 * tolerancia existe porque un salto de ruta borra el anclaje anterior por un
 * instante antes de que aparezca el siguiente, y cerrar por eso un recorrido
 * sano sería cambiar un defecto por otro.
 */
const ANCHOR_LOST_POLL_MS = 500;
const ANCHOR_LOST_TOLERANCE = 8;
const SPOTLIGHT_STYLE_ID = "parallly-guided-tour-spotlight-style";
const SPOTLIGHT_CLASS = "parallly-guided-tour-spotlight";
const SPOTLIGHT_CSS = `
@keyframes parallly-guided-tour-pulse {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.55); }
  70% { box-shadow: 0 0 0 14px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}
.${SPOTLIGHT_CLASS} {
  animation: parallly-guided-tour-pulse 1.3s ease-out 2;
  border-radius: 12px;
  scroll-margin-top: 96px;
  scroll-margin-bottom: 96px;
}
@media (prefers-reduced-motion: reduce) {
  .${SPOTLIGHT_CLASS} { animation: none; outline: 2px solid rgba(99, 102, 241, 0.8); outline-offset: 3px; }
}`;

/**
 * Debajo de 768 px el overlay de Onborda no cabe (sus anclas viven en el
 * sidebar de escritorio). En vez de no hacer nada —que desde el botón se lee
 * como "no funciona"— llevamos el primer anclaje a la vista y lo destacamos.
 */
function spotlightAnchor(selector: string): boolean {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return false;
    if (!document.getElementById(SPOTLIGHT_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = SPOTLIGHT_STYLE_ID;
        style.textContent = SPOTLIGHT_CSS;
        document.head.appendChild(style);
    }
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.classList.add(SPOTLIGHT_CLASS);
    window.setTimeout(() => element.classList.remove(SPOTLIGHT_CLASS), 2_800);
    return true;
}

function isAnchorPresent(selector: string): boolean {
    return Boolean(document.querySelector(selector));
}

/** Espera a que el `router.push` haya llegado de verdad antes de medir nada. */
function waitForRoute(route: string, timeoutMs = GUIDED_TOUR_ANCHOR_TIMEOUT_MS): Promise<boolean> {
    return new Promise((resolve) => {
        if (window.location.pathname === route) {
            resolve(true);
            return;
        }
        const started = Date.now();
        const timer = window.setInterval(() => {
            if (window.location.pathname === route) {
                window.clearInterval(timer);
                resolve(true);
            } else if (Date.now() - started >= timeoutMs) {
                window.clearInterval(timer);
                resolve(false);
            }
        }, 100);
    });
}

/**
 * Espera a que la pantalla se quede quieta antes de decidir qué pasos existen.
 *
 * Medir apenas llega la ruta descarta pasos que sí iban a aparecer (la página
 * todavía está cargando sus datos); esperar el timeout completo cuando NUNCA
 * van a aparecer deja a la persona ocho segundos frente a nada. Se espera a que
 * el conjunto de anclajes presentes no cambie por un momento, con tope.
 */
function waitForAnchorsToSettle(
    selectors: readonly string[],
    { quietMs = 400, timeoutMs = 3_000 }: { quietMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
    const snapshot = () => selectors.filter(isAnchorPresent).join("|");
    return new Promise((resolve) => {
        const started = Date.now();
        let last = snapshot();
        let stableSince = last ? Date.now() : 0;
        const timer = window.setInterval(() => {
            const current = snapshot();
            if (current !== last) {
                last = current;
                stableSince = current ? Date.now() : 0;
            }
            const settled = Boolean(last) && stableSince > 0 && Date.now() - stableSince >= quietMs;
            if (settled || Date.now() - started >= timeoutMs) {
                window.clearInterval(timer);
                resolve(Boolean(last));
            }
        }, 120);
    });
}

/**
 * Pasos del tour guiado. Bloque A (impactan al agente de chat) primero, Bloque B
 * (valor adicional) después. Targetean items SIEMPRE visibles del sidebar por id
 * (`tour-${labelKey}`); los headers de acordeón existen aunque estén colapsados.
 */
export function useProductTourSteps() {
    const t = useTranslations("productTour");
    const tNav = useTranslations("nav");
    const tRoot = useTranslations();
    const locale = useLocale();
    const { verticalConfig } = useAuth();
    const { context: guidedContext, plan: guidedPlan } = useContext(GuidedTourRuntimeContext);
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

    // Los recorridos guiados se registran SIEMPRE: Onborda necesita conocer el
    // tour antes de que alguien lo pida, y el permiso se valida al arrancar.
    const guidedTours = GUIDED_TOUR_IDS.map((id) => ({
        tour: id as string,
        steps: buildGuidedTourSteps(id, guidedContext, (key: string) => tRoot(key), guidedPlan) as any[],
    }));

    return [{ tour: "main", steps }, ...guidedTours];
}

/** Tarjeta del tour (shadcn-styled). */
export function TourCard({ step, currentStep, totalSteps, nextStep, prevStep, arrow }: CardComponentProps) {
    const t = useTranslations("productTour");
    const { closeOnborda } = useOnborda();
    const isLast = currentStep + 1 >= totalSteps;
    const cardRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const closeTour = useCallback(() => {
        closeOnborda();
        window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
    }, [closeOnborda]);

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
            closeTour();
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
                <button onClick={closeTour} className="shrink-0 -mt-1 -mr-1 p-1 text-muted-foreground hover:text-foreground cursor-pointer" aria-label={t("close")}>
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
                        onClick={() => (isLast ? closeTour() : nextStep())}
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
                    try {
                        startOnborda("main");
                    } catch {
                        window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
                    }
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
                try {
                    startOnborda("main");
                } catch {
                    window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
                }
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

/** Un recorrido tal como se va a mostrar: pasos ya traducidos y filtrados. */
type GuidedTourRegistry = ReadonlyArray<{ tour: string; steps: Step[] }>;

/**
 * Aviso breve y NO bloqueante: "este recorrido no se puede mostrar acá".
 *
 * Antes, cuando el anclaje no aparecía, el runner despachaba el evento de
 * cierre y volvía sin decir nada: la persona apretaba un botón, veía cambiar la
 * pantalla y esperaba ocho segundos frente a nada, sin saber si había fallado
 * ella o el producto.
 */
function GuidedTourNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
    const t = useTranslations("productTour");
    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed bottom-4 left-1/2 z-[10000] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-2xl dark:border-white/10 dark:bg-neutral-900"
        >
            <div className="flex items-start gap-2.5">
                <Compass size={15} className="mt-0.5 shrink-0 text-indigo-500" aria-hidden />
                <p className="flex-1 text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300">{text}</p>
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={t("close")}
                    className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}

/**
 * El recorrido en pantallas angostas.
 *
 * Debajo de 768 px el overlay de Onborda no cabe, así que antes sólo quedaba un
 * destello sobre el primer anclaje: cero texto, que es justamente lo que el
 * recorrido tenía para decir. Acá el destello va acompañado del paso escrito,
 * en una tarjeta que no tapa la pantalla ni bloquea los clicks de abajo.
 */
function GuidedTourMobileCard({
    steps, index, onIndexChange, onClose,
}: {
    steps: Step[];
    index: number;
    onIndexChange: (next: number) => void;
    onClose: () => void;
}) {
    const t = useTranslations("productTour");
    const step = steps[index];
    const selector = step?.selector;

    useEffect(() => {
        if (selector) spotlightAnchor(selector);
    }, [selector]);

    if (!step) return null;
    const isLast = index + 1 >= steps.length;

    return (
        <div
            role="dialog"
            aria-modal="false"
            aria-label={step.title}
            className="fixed bottom-3 left-3 right-3 z-[10000] rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-neutral-900"
        >
            <div className="mb-2 flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-base dark:bg-indigo-500/15">
                    {step.icon}
                </div>
                <h3 className="flex-1 pt-1 text-[14px] font-semibold leading-tight text-foreground">{step.title}</h3>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t("close")}
                    className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                    <X size={15} />
                </button>
            </div>
            <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">{step.content}</p>
            <div className="flex items-center justify-between">
                <span className="text-[12px] tabular-nums text-muted-foreground">{index + 1} / {steps.length}</span>
                <div className="flex items-center gap-2">
                    {index > 0 && (
                        <button
                            type="button"
                            onClick={() => onIndexChange(index - 1)}
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-neutral-100 hover:text-foreground dark:hover:bg-white/5"
                        >
                            <ArrowLeft size={14} /> {t("prev")}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => (isLast ? onClose() : onIndexChange(index + 1))}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700"
                    >
                        {isLast ? t("finish") : t("next")} {!isLast && <ArrowRight size={14} />}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Runner de los recorridos guiados ("Mostrarme dónde").
 *
 * Vive dentro de <Onborda> junto a TourLauncher. Escucha el evento del contrato
 * compartido y, antes de arrancar, verifica TODO lo que puede fallar en
 * silencio: id registrado, rol permitido, capacidad del usuario, ancho de
 * pantalla, ruta de entrada y qué anclajes existen de verdad en pantalla.
 *
 * Tres reglas que antes no estaban:
 * - Los pasos imposibles se descartan ANTES de arrancar. Onborda no reintenta:
 *   con un selector que no existe deja el anillo en el elemento anterior y
 *   mantiene una capa que tapa toda la pantalla, así que la persona no podía ni
 *   tocar las casillas que el propio recorrido le estaba pidiendo marcar.
 * - Ya arrancado, un paso que se queda sin anclaje salta al siguiente que sí
 *   esté, y si no queda ninguno el recorrido se cierra en vez de bloquear.
 * - Si el recorrido no se puede mostrar, se dice. Y si para intentarlo hubo que
 *   navegar, se vuelve a donde estaba la persona.
 */
export function GuidedTourRunner({ tours }: { tours: GuidedTourRegistry }) {
    const { startOnborda, closeOnborda, setCurrentStep, currentStep, currentTour, isOnbordaVisible } = useOnborda();
    const router = useRouter();
    const pathname = usePathname();
    const capabilities = useRole();
    const { role } = capabilities;
    const { setContext, setPlan } = useContext(GuidedTourRuntimeContext);
    const tRoot = useTranslations();
    const tTour = useTranslations("productTour");
    const [notice, setNotice] = useState<string | null>(null);
    const [mobileRun, setMobileRun] = useState<{ steps: Step[]; index: number } | null>(null);
    const runRef = useRef(0);
    const noticeTimerRef = useRef<number | null>(null);

    const showNotice = useCallback((text: string) => {
        setNotice(text);
        if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 7_000);
    }, []);
    useEffect(() => () => {
        if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    }, []);

    // El listener se registra UNA vez: `useRole()` devuelve un objeto nuevo en
    // cada render, así que ponerlo en las dependencias re-suscribía el evento
    // constantemente y podía perder un despacho justo en el medio.
    const latestRef = useRef({ role, capabilities, pathname, setContext, setPlan, startOnborda, router, tRoot, tTour, showNotice });
    useEffect(() => {
        latestRef.current = { role, capabilities, pathname, setContext, setPlan, startOnborda, router, tRoot, tTour, showNotice };
    });

    // ── Guardián en vivo: ningún paso puede quedar apuntando a la nada ──
    const toursRef = useRef(tours);
    // Escribir un ref en render rompe con render concurrente: se sincroniza en
    // un efecto, igual que `latestRef` acá arriba.
    useEffect(() => { toursRef.current = tours; });
    useEffect(() => {
        if (!isOnbordaVisible || !currentTour) return;
        let misses = 0;
        const timer = window.setInterval(() => {
            const steps = toursRef.current.find((entry) => entry.tour === currentTour)?.steps ?? [];
            const step = steps[currentStep];
            if (!step) return;
            if (isAnchorPresent(step.selector)) {
                misses = 0;
                return;
            }
            // Un salto de ruta hace desaparecer el anclaje anterior por un
            // instante: se tolera, y sólo se actúa si la ausencia persiste.
            misses += 1;
            if (misses < ANCHOR_LOST_TOLERANCE) return;
            window.clearInterval(timer);
            const nextIndex = steps.findIndex(
                (candidate, index) => index > currentStep && isAnchorPresent(candidate.selector),
            );
            if (nextIndex >= 0) {
                setCurrentStep(nextIndex);
                return;
            }
            closeOnborda();
            window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
            latestRef.current.showNotice(latestRef.current.tTour("unavailable.body"));
        }, ANCHOR_LOST_POLL_MS);
        return () => window.clearInterval(timer);
    }, [closeOnborda, currentStep, currentTour, isOnbordaVisible, setCurrentStep]);

    useEffect(() => {
        let startTimer: number | null = null;

        const handler = (event: Event) => {
            const runtime = latestRef.current;
            const detail = (event as CustomEvent<unknown>).detail as
                { tourId?: unknown; signalId?: unknown; agentId?: unknown } | undefined;
            if (!detail || !isGuidedTourId(detail.tourId)) return;
            const tourId = detail.tourId;
            const tour = getGuidedTour(tourId);
            if (!tour || !canRoleRunGuidedTour(tour, runtime.role)) return;

            const capability = GUIDED_TOUR_CAPABILITY[tourId];
            if (capability && !runtime.capabilities[capability]) return;

            const agentId = typeof detail.agentId === "string" && detail.agentId ? detail.agentId : null;
            const stepContext: GuidedTourStepContext = { agentId };
            runtime.setContext(stepContext);

            const definitions = getGuidedTourStepDefinitions(tourId, stepContext);
            if (definitions.length === 0) return;
            const selectors = definitions.map((definition) => definition.selector);
            const originRoute = runtime.pathname;
            const entryRoute = guidedTourEntryRoute(tourId, stepContext);
            // Dentro del asistente de puesta en marcha el recorrido corre donde
            // está la persona: pedir ayuda no puede significar que te expulsen
            // del formulario a medio llenar.
            const inPlace = shouldRunGuidedTourInPlace(tourId, originRoute);
            const wide = canRunProductTourAtWidth(window.innerWidth);
            const runId = ++runRef.current;
            setMobileRun(null);

            const giveUp = (navigated: boolean) => {
                if (navigated) runtime.router.push(originRoute);
                window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
                runtime.showNotice(runtime.tTour("unavailable.body"));
            };

            void (async () => {
                const mustNavigate = !inPlace && originRoute !== entryRoute;
                if (mustNavigate) {
                    runtime.router.push(entryRoute);
                    const arrived = await waitForRoute(entryRoute);
                    if (runId !== runRef.current) return;
                    if (!arrived) {
                        giveUp(true);
                        return;
                    }
                }
                await waitForAnchorsToSettle(selectors);
                if (runId !== runRef.current) return;

                const currentRoute = mustNavigate ? entryRoute : originRoute;
                const plan = planGuidedTourRun(tourId, stepContext, {
                    currentRoute,
                    // En pantalla angosta no hay saltos de ruta: sólo se muestra
                    // lo que está en pantalla, con su texto.
                    inPlace: inPlace || !wide,
                    isPresent: isAnchorPresent,
                });
                const firstKept = plan.stepIndexes.length > 0 ? definitions[plan.stepIndexes[0]] : undefined;
                // Arrancar en un paso que no está en pantalla es exactamente el
                // caso que dejaba el anillo sobre el elemento equivocado.
                if (!firstKept || !isAnchorPresent(firstKept.selector)) {
                    giveUp(mustNavigate);
                    return;
                }

                if (!wide) {
                    const steps = buildGuidedTourSteps(tourId, stepContext, (key) => runtime.tRoot(key), plan);
                    setMobileRun({ steps, index: 0 });
                    return;
                }

                runtime.setPlan(plan);
                window.dispatchEvent(new Event(PRODUCT_TOUR_PREPARE_EVENT));
                if (startTimer !== null) window.clearTimeout(startTimer);
                // React revela primero las secciones colapsadas del sidebar y
                // aplica el plan; recién entonces Onborda mide los anclajes.
                startTimer = window.setTimeout(() => {
                    if (runId !== runRef.current) return;
                    try {
                        latestRef.current.startOnborda(tourId);
                    } catch {
                        window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
                    }
                }, 350);
            })();
        };

        window.addEventListener(GUIDED_TOUR_START_EVENT, handler);
        return () => {
            window.removeEventListener(GUIDED_TOUR_START_EVENT, handler);
            runRef.current += 1;
            if (startTimer !== null) window.clearTimeout(startTimer);
        };
    }, []);

    const closeMobileRun = useCallback(() => {
        setMobileRun(null);
        window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
    }, []);

    const moveMobileRun = useCallback((next: number) => {
        setMobileRun((run) => {
            if (!run) return run;
            const direction = next > run.index ? 1 : -1;
            for (let index = next; index >= 0 && index < run.steps.length; index += direction) {
                if (isAnchorPresent(run.steps[index].selector)) return { ...run, index };
            }
            // Nada más que señalar en esa dirección: se termina limpio.
            window.dispatchEvent(new Event(PRODUCT_TOUR_CLOSED_EVENT));
            return null;
        });
    }, []);

    return (
        <>
            {mobileRun && (
                <GuidedTourMobileCard
                    steps={mobileRun.steps}
                    index={mobileRun.index}
                    onIndexChange={moveMobileRun}
                    onClose={closeMobileRun}
                />
            )}
            {notice && <GuidedTourNotice text={notice} onDismiss={() => setNotice(null)} />}
        </>
    );
}

/**
 * Envoltorio de Onborda. Vive acá y no en el layout para que los pasos se
 * construyan DENTRO del GuidedTourProvider: el agente enfocado cambia los
 * selectores y las rutas de varios recorridos.
 */
export function ProductTourShell({ children }: { children: React.ReactNode }) {
    const steps = useProductTourSteps();
    return (
        <OnbordaProvider>
            <Onborda steps={steps} cardComponent={TourCard} shadowRgb="0,0,0" shadowOpacity="0.5">
                {children}
                <TourLauncher />
                {/* El runner recibe los MISMOS pasos que Onborda: su guardián en
                    vivo tiene que juzgar lo que se está mostrando, no la
                    declaración sin filtrar. */}
                <GuidedTourRunner tours={steps} />
            </Onborda>
        </OnbordaProvider>
    );
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
