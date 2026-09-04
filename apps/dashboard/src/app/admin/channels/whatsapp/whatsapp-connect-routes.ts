/**
 * The WhatsApp connection routes — ONE catalogue, consumed by both the setup
 * wizard's panel and `/admin/channels/whatsapp`.
 *
 * The two screens used to keep their own lists. The page offered "new number /
 * coexistence / migration"; the wizard offered "coexistence / new number /
 * test number". A person who started in the wizard and finished on the page
 * therefore met a different set of options for the same decision, and the one
 * option that only existed in the wizard — the sandbox number — was never
 * verified to be offered by our `config_id` at all. It is out until it is.
 *
 * `messageKey` is the capitalised segment of the existing i18n keys
 * (`channels.whatsapp.route<MessageKey>Title|Short|Tag|Time|Overview|Step1..4|Req1..4`),
 * so the catalogue does not invent a parallel copy namespace.
 */

export const WHATSAPP_CONNECT_ROUTE_IDS = ["coexistence", "new", "migration"] as const;

export type WhatsAppConnectRouteId = typeof WHATSAPP_CONNECT_ROUTE_IDS[number];

export interface WhatsAppConnectRoute {
    id: WhatsAppConnectRouteId;
    /** Mode the Meta Embedded Signup window is launched with. */
    mode: "standard" | "coexistence";
    /** Exactly one route carries this. It is the one that keeps the chats. */
    recommended: boolean;
    /** Capitalised i18n segment: `route${messageKey}Title`, … */
    messageKey: "Coexistence" | "New" | "Migration";
    /** Numbered `route<Key>Step<n>` entries the brief renders. */
    stepCount: number;
    /** Numbered `route<Key>Req<n>` entries the brief renders. */
    requirementCount: number;
    /** Extra comparison block the brief shows for this route. */
    detail: "sync" | "preservedLost" | null;
    /** `channels.whatsapp.<key>` warnings shown before the connect button. */
    warningKeys: readonly string[];
    /** Accent colours (the two screens style the option differently). */
    accent: { fg: string; bg: string; solid: string };
}

export const WHATSAPP_CONNECT_ROUTES: readonly WhatsAppConnectRoute[] = [
    {
        id: "coexistence",
        mode: "coexistence",
        recommended: true,
        messageKey: "Coexistence",
        stepCount: 4,
        requirementCount: 4,
        detail: "sync",
        warningKeys: ["routeCoexNote"],
        accent: { fg: "text-[#1877F2]", bg: "bg-[#1877F2]/10", solid: "#25D366" },
    },
    {
        id: "new",
        mode: "standard",
        recommended: false,
        messageKey: "New",
        stepCount: 4,
        requirementCount: 4,
        detail: null,
        warningKeys: [],
        accent: { fg: "text-[#25D366]", bg: "bg-[#25D366]/10", solid: "#128C7E" },
    },
    {
        id: "migration",
        mode: "standard",
        recommended: false,
        messageKey: "Migration",
        stepCount: 4,
        requirementCount: 4,
        detail: "preservedLost",
        warningKeys: ["routeMigWarnBM", "routeMigWarn2FA"],
        accent: { fg: "text-orange-500", bg: "bg-orange-500/10", solid: "#f97316" },
    },
];

export function getWhatsAppConnectRoute(id: unknown): WhatsAppConnectRoute | null {
    return WHATSAPP_CONNECT_ROUTES.find((route) => route.id === id) ?? null;
}

export function isWhatsAppConnectRouteId(value: unknown): value is WhatsAppConnectRouteId {
    return typeof value === "string"
        && (WHATSAPP_CONNECT_ROUTE_IDS as readonly string[]).includes(value);
}

/** `channels.whatsapp` key for one of the route's numbered/labelled strings. */
export function whatsAppRouteKey(route: WhatsAppConnectRoute, suffix: string): string {
    return `route${route.messageKey}${suffix}`;
}
