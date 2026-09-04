import type { Step } from "onborda";
import {
  GUIDED_TOUR_IDS,
  getGuidedTour,
  type GuidedTourId,
} from "@parallext/shared";

/**
 * Guided tours — the dashboard half of `packages/shared/src/guided-tour-contract.ts`.
 *
 * The shared contract decides WHICH tour is relevant (from a quality signal, an
 * assistant marker or a help panel). This module decides HOW it is rendered:
 * the anchor each step points at, the route that anchor lives on, and the i18n
 * keys for its copy.
 *
 * Anchors are declared here and only here. `guided-tours.spec.ts` checks that
 * every anchor named below is actually rendered somewhere in `src/`, so a
 * renamed element breaks a test instead of silently producing a tour that
 * spotlights nothing.
 */

/** `id={guidedTourAnchorId("whatsapp-connect")}` → `#tour-target-whatsapp-connect`. */
export function guidedTourAnchorId(name: string): string {
  return `tour-target-${name}`;
}

export function guidedTourSelector(name: string): string {
  return `#${guidedTourAnchorId(name)}`;
}

/** Sidebar items already carry `#tour-<labelKey>` (AppSidebar). */
export function sidebarTourSelector(labelKey: string): string {
  return `#tour-${labelKey}`;
}

export interface GuidedTourContext {
  /** Focused agent, when the tour was launched from a quality signal or the agent list. */
  agentId?: string | null;
  /** Vertical catalogue route for tenants whose knowledge lives in a catalogue. */
  verticalCatalogRoute?: string | null;
}

export interface GuidedTourStepDefinition {
  /** CSS selector of the element to spotlight. */
  selector: string;
  /** Route this anchor lives on. Omit to stay on the previous step's route. */
  route?: AdminRoute;
  /** i18n key suffix under `guidedTours.<tourId>.steps`. */
  key: string;
  side?: Step["side"];
  icon?: string;
}

type StepFactory = (context: GuidedTourContext) => GuidedTourStepDefinition[];

type AdminRoute = `/admin${string}`;

const agentRoute = (context: GuidedTourContext): AdminRoute =>
  context.agentId ? `/admin/agent/${context.agentId}` : "/admin/agent";

const STEP_DEFINITIONS: Record<GuidedTourId, StepFactory> = {
  // ── Part I: repairing what Agent health flags ───────────────────────────
  connect_channel: () => [
    { selector: sidebarTourSelector("channels"), route: "/admin/channels", key: "menu", icon: "🔌", side: "right" },
    { selector: guidedTourSelector("channel-cards"), key: "cards", icon: "🧩", side: "top" },
    { selector: guidedTourSelector("channel-card-whatsapp"), key: "whatsapp", icon: "💬", side: "top" },
    { selector: guidedTourSelector("whatsapp-status"), route: "/admin/channels/whatsapp", key: "status", icon: "✅", side: "bottom" },
  ],
  assign_agent_channel: (context) => [
    { selector: sidebarTourSelector("aiAgent"), route: "/admin/agent", key: "menu", icon: "🤖", side: "right" },
    { selector: guidedTourSelector("agent-list"), key: "list", icon: "📋", side: "top" },
    { selector: guidedTourSelector("agent-channels"), route: agentRoute(context), key: "channels", icon: "🔗", side: "top" },
    { selector: guidedTourSelector("agent-save"), key: "save", icon: "💾", side: "top" },
  ],
  agent_handoff_rules: (context) => [
    { selector: guidedTourSelector("agent-name"), route: agentRoute(context), key: "name", icon: "🪪", side: "bottom" },
    { selector: guidedTourSelector("agent-greeting"), key: "greeting", icon: "👋", side: "bottom" },
    { selector: guidedTourSelector("agent-fallback"), key: "fallback", icon: "🛟", side: "bottom" },
    { selector: guidedTourSelector("agent-rules"), key: "rules", icon: "📏", side: "top" },
    { selector: guidedTourSelector("agent-handoff-triggers"), key: "handoff", icon: "🙋", side: "top" },
    { selector: guidedTourSelector("agent-save"), key: "save", icon: "💾", side: "top" },
  ],
  human_handoff_route: () => [
    { selector: sidebarTourSelector("users"), route: "/admin/users", key: "menu", icon: "👥", side: "right" },
    { selector: guidedTourSelector("users-invite"), key: "invite", icon: "✉️", side: "bottom" },
    { selector: guidedTourSelector("users-role"), key: "role", icon: "🎭", side: "top" },
    { selector: guidedTourSelector("users-list"), key: "pending", icon: "⏳", side: "top" },
  ],
  business_identity: () => [
    { selector: guidedTourSelector("business-name"), route: "/admin/settings/business-info", key: "name", icon: "🏪", side: "bottom" },
    { selector: guidedTourSelector("business-about"), key: "about", icon: "📝", side: "bottom" },
    { selector: guidedTourSelector("business-contact"), key: "contact", icon: "📞", side: "top" },
    { selector: guidedTourSelector("business-save"), key: "save", icon: "💾", side: "top" },
  ],
  knowledge_base: () => [
    { selector: guidedTourSelector("knowledge-tabs"), route: "/admin/knowledge", key: "tabs", icon: "📚", side: "bottom" },
    { selector: guidedTourSelector("faq-new"), route: "/admin/knowledge/faqs", key: "newFaq", icon: "➕", side: "bottom" },
    { selector: guidedTourSelector("faq-fields"), key: "fields", icon: "❓", side: "top" },
    { selector: guidedTourSelector("faq-published"), key: "published", icon: "📣", side: "top" },
    { selector: guidedTourSelector("knowledge-add"), route: "/admin/knowledge", key: "documents", icon: "📄", side: "bottom" },
  ],
  appointments_setup: () => [
    { selector: guidedTourSelector("appointments-tabs"), route: "/admin/appointments", key: "tabs", icon: "🗓️", side: "bottom" },
    { selector: guidedTourSelector("appointments-new-service"), key: "service", icon: "✂️", side: "top" },
    { selector: guidedTourSelector("appointments-schedule"), key: "schedule", icon: "⏰", side: "top" },
  ],
  business_hours: () => [
    { selector: guidedTourSelector("hours-247"), route: "/admin/settings/business-hours", key: "always", icon: "🌙", side: "bottom" },
    { selector: guidedTourSelector("hours-timezone"), key: "timezone", icon: "🌎", side: "bottom" },
    { selector: guidedTourSelector("hours-days"), key: "days", icon: "📆", side: "top" },
    { selector: guidedTourSelector("hours-message"), key: "message", icon: "💬", side: "top" },
    { selector: guidedTourSelector("hours-save"), key: "save", icon: "💾", side: "top" },
  ],
  run_agent_tests: () => [
    { selector: guidedTourSelector("simulation-launch"), route: "/admin/agent/simulation", key: "launch", icon: "🧪", side: "bottom" },
    { selector: guidedTourSelector("simulation-history"), key: "history", icon: "📊", side: "top" },
  ],
  agent_quality_center: () => [
    { selector: guidedTourSelector("quality-agent-select"), route: "/admin/agent/quality", key: "agent", icon: "🤖", side: "bottom" },
    { selector: guidedTourSelector("quality-priority"), key: "priority", icon: "🎯", side: "top" },
    { selector: guidedTourSelector("quality-dimensions"), key: "dimensions", icon: "🔍", side: "top" },
  ],

  // ── Part II: onboarding, first channel and the help system ──────────────
  home_first_steps: () => [
    { selector: guidedTourSelector("setup-card"), route: "/admin", key: "card", icon: "🚀", side: "bottom" },
    { selector: guidedTourSelector("setup-next"), key: "next", icon: "👉", side: "bottom" },
    { selector: guidedTourSelector("help-panel"), key: "help", icon: "💡", side: "bottom" },
    { selector: guidedTourSelector("assistant"), key: "assistant", icon: "🙋", side: "left" },
  ],
  /**
   * El orden es el que recorre la persona, no el del archivo: primero el
   * estado, después el pre-check (que es lo ÚNICO en pantalla mientras no se
   * confirme), recién entonces las rutas, el resumen y el botón. La prueba
   * final vive detrás de una conexión que todavía no existe cuando este
   * recorrido se ofrece: queda como paso opcional y el plan de ejecución la
   * descarta sola si el ancla no está en pantalla.
   */
  first_channel_whatsapp: () => [
    { selector: guidedTourSelector("whatsapp-status"), route: "/admin/channels/whatsapp", key: "status", icon: "📶", side: "bottom" },
    { selector: guidedTourSelector("whatsapp-prerequisites"), key: "prerequisites", icon: "📋", side: "top" },
    { selector: guidedTourSelector("whatsapp-routes"), key: "routes", icon: "🛣️", side: "top" },
    { selector: guidedTourSelector("whatsapp-brief"), key: "brief", icon: "⚠️", side: "top" },
    { selector: guidedTourSelector("whatsapp-connect"), key: "connect", icon: "🔵", side: "top" },
    { selector: guidedTourSelector("whatsapp-test"), key: "test", icon: "🎉", side: "bottom" },
  ],
  resume_setup_wizard: () => [
    { selector: guidedTourSelector("resume-setup"), route: "/admin", key: "entry", icon: "↩️", side: "bottom" },
    { selector: guidedTourSelector("setup-steps"), route: "/admin/setup-wizard", key: "steps", icon: "🧭", side: "bottom" },
    { selector: guidedTourSelector("setup-connect"), key: "connect", icon: "🔌", side: "top" },
  ],
  help_system: () => [
    { selector: guidedTourSelector("help-panel"), key: "panel", icon: "💡", side: "bottom" },
    { selector: guidedTourSelector("help-show-me"), key: "showMe", icon: "🧭", side: "bottom" },
    { selector: guidedTourSelector("command-palette"), key: "palette", icon: "⌨️", side: "bottom" },
    { selector: guidedTourSelector("assistant"), key: "assistant", icon: "🙋", side: "left" },
  ],
  inbox_first_conversation: () => [
    { selector: guidedTourSelector("inbox-list"), route: "/admin/inbox", key: "list", icon: "💬", side: "right" },
    { selector: guidedTourSelector("inbox-filter-unassigned"), key: "filter", icon: "🔎", side: "bottom" },
    { selector: guidedTourSelector("inbox-take"), key: "take", icon: "✋", side: "bottom" },
    { selector: guidedTourSelector("inbox-summary"), key: "summary", icon: "📝", side: "bottom" },
  ],
};

/** Every anchor name this module points at, for the contract test. */
export const GUIDED_TOUR_ANCHOR_NAMES: readonly string[] = Array.from(
  new Set(
    GUIDED_TOUR_IDS.flatMap((id) =>
      STEP_DEFINITIONS[id]({ agentId: "00000000-0000-4000-8000-000000000000" })
        .map((step) => step.selector)
        .filter((selector) => selector.startsWith("#tour-target-"))
        .map((selector) => selector.replace("#tour-target-", "")),
    ),
  ),
).sort();

export function getGuidedTourStepDefinitions(
  tourId: GuidedTourId,
  context: GuidedTourContext = {},
): GuidedTourStepDefinition[] {
  return STEP_DEFINITIONS[tourId](context);
}

/** The route a step runs on, resolving the "inherit from the previous step" rule. */
export function resolveGuidedTourStepRoutes(
  tourId: GuidedTourId,
  context: GuidedTourContext = {},
): string[] {
  const entry: AdminRoute = getGuidedTour(tourId)?.route ?? "/admin";
  let current: AdminRoute = entry;
  return getGuidedTourStepDefinitions(tourId, context).map((step) => {
    if (step.route) current = step.route;
    return current;
  });
}

/** The route the runner must be on before step 0 can be spotlighted. */
export function guidedTourEntryRoute(
  tourId: GuidedTourId,
  context: GuidedTourContext = {},
): string {
  return resolveGuidedTourStepRoutes(tourId, context)[0]
    ?? getGuidedTour(tourId)?.route
    ?? "/admin";
}

/**
 * Pantallas donde la persona está adentro de un flujo con avance sin guardar.
 *
 * "Mostrarme cómo" dentro del asistente de puesta en marcha disparaba un
 * `router.push` a `/admin/channels/whatsapp`: la persona pedía ayuda y la
 * respuesta era sacarla del asistente. Acá el recorrido se corre con lo que
 * haya en pantalla o no se corre, pero nadie se va expulsado.
 */
export const GUIDED_TOUR_NO_EJECT_ROUTES: readonly string[] = ["/admin/setup-wizard"];

/** True cuando el recorrido debe correr donde ya está la persona. */
export function shouldRunGuidedTourInPlace(
  tourId: GuidedTourId,
  currentRoute: string,
): boolean {
  if (getGuidedTour(tourId)?.stayOnCurrentRoute) return true;
  return GUIDED_TOUR_NO_EJECT_ROUTES.some(
    (route) => currentRoute === route || currentRoute.startsWith(`${route}/`),
  );
}

/**
 * Qué pasos se van a mostrar REALMENTE en esta corrida.
 *
 * Un recorrido declarado no es un recorrido posible: en `/admin/channels/whatsapp`
 * el pre-check y las tarjetas de ruta son las dos ramas de un mismo ternario, y
 * la prueba post-conexión exige un número conectado. Sin este plan, Onborda
 * recibía seis pasos, encontraba dos, y para los otros cuatro dejaba el anillo
 * donde estaba con una capa que tapa la pantalla: el usuario no podía ni tocar
 * las casillas que el propio recorrido le estaba pidiendo marcar.
 */
export interface GuidedTourRunPlan {
  tourId: GuidedTourId;
  /** Índices —sobre las definiciones del recorrido— que sí se van a mostrar. */
  stepIndexes: number[];
  /** El recorrido corre donde ya está la persona: sin empujes de ruta. */
  inPlace: boolean;
}

export interface GuidedTourPlanOptions {
  /** Ruta en la que va a arrancar el recorrido. */
  currentRoute: string;
  /** True cuando no se puede (o no se debe) navegar: sólo vale lo que hay acá. */
  inPlace: boolean;
  /** Si el ancla existe en el DOM. Inyectado para poder probarlo sin navegador. */
  isPresent: (selector: string) => boolean;
}

/**
 * Descarta los pasos cuyo anclaje no existe.
 *
 * Sólo se puede juzgar lo que está en pantalla: un paso que vive en otra ruta
 * todavía no se renderizó, así que se conserva y de él se encarga el guardián
 * en vivo del runner (saltea o cierra si al llegar tampoco está).
 */
export function planGuidedTourRun(
  tourId: GuidedTourId,
  context: GuidedTourContext,
  { currentRoute, inPlace, isPresent }: GuidedTourPlanOptions,
): GuidedTourRunPlan {
  const definitions = getGuidedTourStepDefinitions(tourId, context);
  const routes = resolveGuidedTourStepRoutes(tourId, context);
  const stepIndexes = definitions.reduce<number[]>((kept, definition, index) => {
    const judgeable = inPlace || routes[index] === currentRoute;
    if (!judgeable || isPresent(definition.selector)) kept.push(index);
    return kept;
  }, []);
  return { tourId, stepIndexes, inPlace };
}

type Translate = (key: string) => string;

/**
 * Onborda steps for one tour. Consecutive steps on different routes become
 * `nextRoute`/`prevRoute`, which Onborda pushes before waiting for the next
 * anchor to appear in the DOM.
 *
 * Con un plan, los pasos descartados desaparecen ANTES de que Onborda mida
 * nada, y los saltos de ruta se recalculan sobre la secuencia que queda.
 */
export function buildGuidedTourSteps(
  tourId: GuidedTourId,
  context: GuidedTourContext,
  t: Translate,
  plan?: GuidedTourRunPlan | null,
): Step[] {
  const allDefinitions = getGuidedTourStepDefinitions(tourId, context);
  const allRoutes = resolveGuidedTourStepRoutes(tourId, context);
  const applied = plan && plan.tourId === tourId ? plan : null;
  const kept = applied
    ? applied.stepIndexes.filter((index) => allDefinitions[index] !== undefined)
    : allDefinitions.map((_, index) => index);

  const definitions = kept.map((index) => allDefinitions[index]);
  // Quedarse donde está la persona significa exactamente eso: sin nextRoute,
  // Onborda no empuja ninguna ruta y nadie sale del flujo a medio hacer.
  const routes = applied?.inPlace
    ? kept.map(() => allRoutes[kept[0]] ?? "")
    : kept.map((index) => allRoutes[index]);

  return definitions.map((definition, index) => {
    const nextRoute = routes[index + 1] !== undefined && routes[index + 1] !== routes[index]
      ? routes[index + 1]
      : undefined;
    const previousRoute = index > 0 && routes[index - 1] !== routes[index]
      ? routes[index - 1]
      : undefined;

    return {
      icon: definition.icon ?? "🧭",
      title: t(`guidedTours.${tourId}.steps.${definition.key}.title`),
      content: t(`guidedTours.${tourId}.steps.${definition.key}.content`),
      selector: definition.selector,
      side: definition.side ?? "bottom",
      showControls: true,
      pointerPadding: 8,
      pointerRadius: 12,
      ...(nextRoute ? { nextRoute } : {}),
      ...(previousRoute ? { prevRoute: previousRoute } : {}),
    } as Step;
  });
}

/** i18n keys every tour needs, for the parity test across the four locales. */
export function guidedTourMessageKeys(): string[] {
  return GUIDED_TOUR_IDS.flatMap((id) =>
    getGuidedTourStepDefinitions(id, { agentId: "00000000-0000-4000-8000-000000000000" })
      .flatMap((step) => [
        `guidedTours.${id}.steps.${step.key}.title`,
        `guidedTours.${id}.steps.${step.key}.content`,
      ]),
  );
}
