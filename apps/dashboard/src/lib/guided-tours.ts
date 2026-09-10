import type { Step } from "onborda";
import {
  GUIDED_TOUR_IDS,
  canRoleRunGuidedTour,
  getGuidedTour,
  isGuidedTourId,
  type GuidedTourId,
  type GuidedTourStepStatus,
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
  channelType?: string | null;
  /** Focused agent, when the tour was launched from a quality signal or the agent list. */
  agentId?: string | null;
  /** Vertical catalogue route for tenants whose knowledge lives in a catalogue. */
  verticalCatalogRoute?: string | null;
}

/**
 * How a step can tell whether the thing it is about is already done.
 *
 * Read-only by construction: both shapes are queries against the DOM the tour
 * already points at, so honouring the contract's "tours never change data" rule
 * is not a matter of discipline — there is nothing here that could write.
 *
 * The vocabulary is deliberately small. A condition only exists where the
 * screen itself settles the question; anywhere the answer lives behind a CSS
 * class or an API call, the step declares nothing and the run says `unknown`.
 */
export type GuidedTourStepCondition =
  /**
   * Form controls inside the anchor carry text. `all` is for anchors whose every
   * field is required; otherwise `min` non-empty controls are enough. An anchor
   * that holds no control at all reads as `pending`, never as `done`: a list the
   * tenant never added a row to is genuinely empty.
   */
  | { kind: "filled"; within?: string; min?: number; all?: boolean }
  /**
   * An element the screen renders ONLY once the goal is met — e.g. the
   * post-connection test block on `/admin/channels/whatsapp`, which exists just
   * for a number that is already connected.
   */
  | { kind: "present"; selector: string };

export interface GuidedTourStepDefinition {
  /** CSS selector of the element to spotlight. */
  selector: string;
  /** Route this anchor lives on. Omit to stay on the previous step's route. */
  route?: AdminRoute;
  /** i18n key suffix under `guidedTours.<tourId>.steps`. */
  key: string;
  side?: Step["side"];
  icon?: string;
  /** Safe UI preparation only; never submit, save or dismiss a form. */
  prepareSelector?: string;
  optional?: boolean;
  /** What the screen has to show for this step's goal to count as done. */
  completedWhen?: GuidedTourStepCondition;
}

/** Reads the live screen for the condition evaluator. Injected, so it is testable. */
export interface GuidedTourConditionProbe {
  /**
   * Trimmed values of the form controls inside `selector`, or `null` when the
   * anchor itself is not on screen — which is the difference between "empty"
   * and "we never got to look".
   */
  fieldValues: (selector: string, within?: string) => string[] | null;
  exists: (selector: string) => boolean;
}

/**
 * What the screen says about one step, right now.
 *
 * Returns `null` for a step that makes no claim, which is not the same as
 * `unknown`: `null` means the tour never promised to check, `unknown` means it
 * tried and could not tell. Only the second one belongs in the end-of-run tally.
 */
export function evaluateGuidedTourStep(
  step: Pick<GuidedTourStepDefinition, "selector" | "completedWhen">,
  probe: GuidedTourConditionProbe,
): GuidedTourStepStatus | null {
  const condition = step.completedWhen;
  if (!condition) return null;

  if (condition.kind === "present") {
    // Judging the proof element without seeing the anchor would read every
    // other screen in the panel as "not configured".
    if (!probe.exists(step.selector)) return "unknown";
    return probe.exists(condition.selector) ? "done" : "pending";
  }

  const values = probe.fieldValues(step.selector, condition.within);
  if (values === null) return "unknown";
  const filled = values.filter((value) => value.trim().length > 0).length;
  if (condition.all) return values.length > 0 && filled === values.length ? "done" : "pending";
  return filled >= (condition.min ?? 1) ? "done" : "pending";
}

type StepFactory = (context: GuidedTourContext) => GuidedTourStepDefinition[];

type AdminRoute = `/admin${string}`;

const agentRoute = (context: GuidedTourContext): AdminRoute =>
  context.agentId ? `/admin/agent/${context.agentId}` : "/admin/agent";

const STEP_DEFINITIONS: Record<GuidedTourId, StepFactory> = {
  // ── Part I: repairing what Agent health flags ───────────────────────────
  connect_channel: (context) => [
    { selector: sidebarTourSelector("channels"), route: "/admin/channels", key: "menu", icon: "🔌", side: "right" },
    { selector: guidedTourSelector("channel-cards"), key: "cards", icon: "🧩", side: "top" },
    ...(context.channelType && ["whatsapp", "instagram", "messenger", "telegram"].includes(context.channelType)
      ? [{ selector: guidedTourSelector(`channel-card-${context.channelType}`), key: "channel", icon: "💬", side: "top" as const,
          // The card's badge already distinguishes connected from disconnected
          // from unreadable; `data-channel-status` is the same three states in
          // something a selector can read. An unreadable overview matches
          // neither value, so it lands on `pending`, never on a false `done`.
          completedWhen: { kind: "present" as const,
            selector: `${guidedTourSelector(`channel-card-${context.channelType}`)} [data-channel-status="connected"]` } }] : []),
    ...(context.channelType === "web_chat" ? [{ selector: guidedTourSelector("web-chat-setup"), route: "/admin/settings/integrations/web-chat" as AdminRoute, key: "channel", icon: "💬" }] : []),
  ],
  assign_agent_channel: (context) => [
    ...(!context.agentId ? [
      { selector: sidebarTourSelector("aiAgent"), route: "/admin/agent" as AdminRoute, key: "menu", icon: "🤖", side: "right" as const },
      { selector: guidedTourSelector("agent-list"), key: "list", icon: "📋", side: "top" as const },
    ] : []),
    // One assigned chip is the whole point of this tour. `aria-pressed` is what
    // the chip says to a screen reader too; the indigo class and the check icon
    // were never readable by anything but an eye.
    { selector: guidedTourSelector("agent-channels"), route: agentRoute(context), key: "channels", icon: "🔗", side: "top", prepareSelector: '[data-tab-id="persona"]',
      completedWhen: { kind: "present", selector: `${guidedTourSelector("agent-channels")} [aria-pressed="true"]` } },
    { selector: guidedTourSelector("agent-save"), key: "save", icon: "💾", side: "top" },
  ],
  agent_handoff_rules: (context) => [
    { selector: guidedTourSelector("agent-name"), route: agentRoute(context), key: "name", icon: "🪪", side: "bottom", prepareSelector: '[data-tab-id="persona"]', completedWhen: { kind: "filled", all: true } },
    { selector: guidedTourSelector("agent-greeting"), key: "greeting", icon: "👋", side: "bottom", prepareSelector: '[data-tab-id="persona"]', completedWhen: { kind: "filled" } },
    { selector: guidedTourSelector("agent-fallback"), key: "fallback", icon: "🛟", side: "bottom", prepareSelector: '[data-tab-id="persona"]', completedWhen: { kind: "filled" } },
    { selector: guidedTourSelector("agent-rules"), key: "rules", icon: "📏", side: "top", prepareSelector: '[data-tab-id="instructions"]', completedWhen: { kind: "filled", within: "input" } },
    { selector: guidedTourSelector("agent-handoff-triggers"), key: "handoff", icon: "🙋", side: "top", prepareSelector: '[data-tab-id="instructions"]', completedWhen: { kind: "filled", within: "input" } },
    { selector: guidedTourSelector("agent-save"), key: "save", icon: "💾", side: "top" },
  ],
  human_handoff_route: () => [
    { selector: sidebarTourSelector("users"), route: "/admin/users", key: "menu", icon: "👥", side: "right" },
    { selector: guidedTourSelector("users-list"), key: "pending", icon: "⏳", side: "top" },
    { selector: guidedTourSelector("users-invite"), key: "invite", icon: "✉️", side: "bottom" },
    { selector: guidedTourSelector("users-role"), key: "role", icon: "🎭", side: "top", prepareSelector: guidedTourSelector("users-invite") },
  ],
  business_identity: () => [
    { selector: guidedTourSelector("business-name"), route: "/admin/settings/business-info", key: "name", icon: "🏪", side: "bottom", completedWhen: { kind: "filled" } },
    { selector: guidedTourSelector("business-about"), key: "about", icon: "📝", side: "bottom", completedWhen: { kind: "filled" } },
    { selector: guidedTourSelector("business-contact"), key: "contact", icon: "📞", side: "top", completedWhen: { kind: "filled" } },
    { selector: guidedTourSelector("business-save"), key: "save", icon: "💾", side: "top" },
  ],
  knowledge_base: () => [
    { selector: guidedTourSelector("knowledge-tabs"), route: "/admin/knowledge", key: "tabs", icon: "📚", side: "bottom" },
    { selector: guidedTourSelector("knowledge-add"), key: "documents", icon: "📄", side: "bottom" },
    { selector: guidedTourSelector("faq-new"), route: "/admin/knowledge/faqs", key: "newFaq", icon: "➕", side: "bottom" },
    // No `completedWhen`: `prepareSelector` clicks "new FAQ", so the fields this
    // step points at are a blank form the tour itself just opened. A `filled`
    // check here could only ever answer "todavía falta", including for a tenant
    // whose knowledge base is full — a badge that is always wrong is worse than
    // no badge, because people stop reading the ones that are right.
    { selector: guidedTourSelector("faq-fields"), key: "fields", icon: "❓", side: "top", prepareSelector: guidedTourSelector("faq-new") },
    { selector: guidedTourSelector("faq-published"), key: "published", icon: "📣", side: "top" },
  ],
  appointments_setup: () => [
    { selector: guidedTourSelector("appointments-tabs"), route: "/admin/appointments", key: "tabs", icon: "🗓️", side: "bottom" },
    { selector: guidedTourSelector("appointments-new-service"), key: "service", icon: "✂️", side: "top", prepareSelector: '[data-tab-id="services"]' },
    { selector: guidedTourSelector("appointments-schedule"), key: "schedule", icon: "⏰", side: "top", prepareSelector: '[data-tab-id="config"]' },
  ],
  business_hours: () => [
    { selector: guidedTourSelector("hours-247"), route: "/admin/settings/business-hours", key: "always", icon: "🌙", side: "bottom" },
    { selector: guidedTourSelector("hours-timezone"), key: "timezone", icon: "🌎", side: "bottom" },
    { selector: guidedTourSelector("hours-days"), key: "days", icon: "📆", side: "top" },
    { selector: guidedTourSelector("hours-message"), key: "message", icon: "💬", side: "top", completedWhen: { kind: "filled" } },
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
    { selector: guidedTourSelector("whatsapp-status"), route: "/admin/channels/whatsapp", key: "status", icon: "📶", side: "bottom", completedWhen: { kind: "present", selector: guidedTourSelector("whatsapp-test") } },
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

/**
 * Every anchor name this module points at, for the contract test.
 *
 * Includes the elements a `completedWhen` looks for, not just the ones it
 * spotlights: a condition aimed at an element nobody renders any more would
 * quietly answer `pending` forever, which reads as "you never did this".
 */
export const GUIDED_TOUR_ANCHOR_NAMES: readonly string[] = Array.from(
  new Set(
    GUIDED_TOUR_IDS.flatMap((id) =>
      STEP_DEFINITIONS[id]({ agentId: "00000000-0000-4000-8000-000000000000" })
        .flatMap((step) => [
          step.selector,
          ...(step.completedWhen?.kind === "present" ? [step.completedWhen.selector] : []),
        ])
        // A condition may be a compound selector — an anchor plus the attribute
        // that proves its goal, e.g. `#tour-target-agent-channels
        // [aria-pressed="true"]`. Every anchor id inside it still has to be
        // rendered, so the names are extracted rather than the string taken
        // whole; treating the compound as one name would look for an element
        // called `agent-channels [aria-pressed="true"]` and never find it.
        .flatMap((selector) => selector.match(/#tour-target-[A-Za-z0-9_-]+/g) ?? [])
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
    const optional = definition.optional || !definition.selector.startsWith("#tour-target-") || tourId === "first_channel_whatsapp" || tourId === "help_system";
    if (inPlace && routes[index] !== currentRoute && !isPresent(definition.selector)) return kept;
    if (!judgeable || !optional || isPresent(definition.selector)) kept.push(index);
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
      prepareSelector: definition.prepareSelector,
      completedWhen: definition.completedWhen,
      tourRoute: applied?.inPlace ? undefined : allRoutes[kept[index]],
      optional: definition.optional || tourId === "first_channel_whatsapp" || tourId === "help_system",
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

/**
 * Retomar un recorrido después de una recarga.
 *
 * Varios recorridos saltan entre rutas de `/admin`, y hasta acá cualquier F5 —o
 * el reload que provoca una pantalla al guardar— mataba el recorrido sin decir
 * nada: la persona quedaba parada en una pantalla cualquiera, sin overlay y sin
 * explicación, convencida de que había roto algo.
 *
 * Vive en `sessionStorage` a propósito. El recorrido pertenece a la pestaña que
 * lo abrió: no tiene que reaparecer mañana, ni saltar a la otra pestaña donde la
 * persona estaba haciendo otra cosa. El TTL corto es el segundo cinturón, para
 * la pestaña que quedó abierta toda la noche.
 */
const GUIDED_TOUR_RESUME_KEY = "parallly:tour:resume";
const GUIDED_TOUR_RESUME_TTL_MS = 20 * 60 * 1000;

export type GuidedTourStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface GuidedTourResumeRecord {
  tourId: GuidedTourId;
  /** Índice sobre los pasos YA planificados de la corrida, no sobre las definiciones. */
  stepIndex: number;
  /** Ruta en la que estaba el paso. Volver a otra pantalla no es retomar. */
  route: string;
  /** `${userId}:${tenantId}` — otro usuario en el mismo navegador no hereda esto. */
  scope: string;
  context: GuidedTourContext;
  savedAt: number;
}

function isPlainContext(value: unknown): value is GuidedTourContext {
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, entry]) => ["channelType", "agentId", "verticalCatalogRoute"].includes(key)
      && (entry === null || typeof entry === "string"),
  );
}

/**
 * Valida el registro guardado sin tocar el navegador.
 *
 * Todo lo que no se pueda comprobar acá se descarta: un id que ya no está en el
 * registro, un rol que la persona perdió entre la recarga y ahora, otra ruta,
 * otro usuario, o un `savedAt` fuera de la ventana. Retomar de más es peor que
 * no retomar: el recorrido se abriría solo encima de otra tarea.
 */
export function parseGuidedTourResume(
  raw: string | null,
  { scope, route, role, now = Date.now() }: { scope: string; route: string; role: string | null | undefined; now?: number },
): GuidedTourResumeRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GuidedTourResumeRecord>;
    if (!isGuidedTourId(value.tourId)) return null;
    const tour = getGuidedTour(value.tourId);
    if (!tour || !canRoleRunGuidedTour(tour, role)) return null;
    if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) return null;
    // Un reloj adelantado no habilita un recorrido eterno.
    if (value.savedAt > now + 60_000 || now - value.savedAt > GUIDED_TOUR_RESUME_TTL_MS) return null;
    if (typeof value.stepIndex !== "number" || !Number.isInteger(value.stepIndex) || value.stepIndex < 0) return null;
    if (value.route !== route || !value.scope || value.scope !== scope) return null;
    if (!isPlainContext(value.context)) return null;
    return {
      tourId: value.tourId,
      stepIndex: value.stepIndex,
      route: value.route,
      scope: value.scope,
      context: value.context,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveGuidedTourResume(
  storage: GuidedTourStorageLike,
  record: Omit<GuidedTourResumeRecord, "savedAt">,
  now = Date.now(),
): void {
  try {
    storage.setItem(GUIDED_TOUR_RESUME_KEY, JSON.stringify({ ...record, savedAt: now }));
  } catch {
    // Una ventana privada rechaza el almacenamiento; el recorrido corre igual,
    // sólo que no sobrevive a la recarga.
  }
}

/** Lee y consume el registro: un intento de retomar, no un bucle de reintentos. */
export function readGuidedTourResume(
  storage: GuidedTourStorageLike,
  options: { scope: string; route: string; role: string | null | undefined; now?: number },
): GuidedTourResumeRecord | null {
  try {
    const record = parseGuidedTourResume(storage.getItem(GUIDED_TOUR_RESUME_KEY), options);
    storage.removeItem(GUIDED_TOUR_RESUME_KEY);
    return record;
  } catch {
    return null;
  }
}

export function clearGuidedTourResume(storage: GuidedTourStorageLike): void {
  try { storage.removeItem(GUIDED_TOUR_RESUME_KEY); } catch { /* almacenamiento no disponible */ }
}
