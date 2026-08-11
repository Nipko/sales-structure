/**
 * Canonical navigation contract for the dashboard.
 *
 * This module is intentionally UI-agnostic. Sidebar, breadcrumbs, page headers,
 * command palettes and contextual "back" links can all consume the same route
 * metadata without importing React or Next.js.
 */

export type NavigationScope = "shared" | "tenant" | "platform";

export interface NavigationRouteDefinition {
  /** Stable identifier used by navigation consumers and tests. */
  id: string;
  /** Canonical page pattern. Dynamic segments use `:paramName`. */
  pattern: `/admin${string}`;
  /** Fully-qualified next-intl key. */
  titleKey: string;
  /** Product surface that owns the page. */
  scope: NavigationScope;
  /** Semantic breadcrumb parent (not necessarily the URL parent). */
  parentId?: string;
  /** Optional semantic return override; parentId is used when omitted. */
  returnFallbackId?: string;
  /** Param whose resolved entity name may replace titleKey in breadcrumbs. */
  dynamicTitleParam?: string;
  /** False for callbacks or legacy aliases that should not appear in search. */
  discoverable?: boolean;
}

export type NavigationLabelOverrides = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/** Extract the shared sidebar label key used by vertical terminology. */
export function navigationItemKeyFromTitleKey(titleKey: string): string | null {
  const prefix = "nav.items.";
  return titleKey.startsWith(prefix) ? titleKey.slice(prefix.length) : null;
}

/** Resolve a vertical label override consistently across every nav surface. */
export function resolveNavigationDisplayLabel(
  labelKey: string | null | undefined,
  translatedLabel: string,
  locale: string,
  overrides?: NavigationLabelOverrides | null,
): string {
  if (!labelKey || !overrides?.[labelKey]) return translatedLabel;
  const baseLocale = locale.split("-")[0];
  return overrides[labelKey][locale]
    || overrides[labelKey][baseLocale]
    || translatedLabel;
}

const NAVIGATION_ROUTE_DEFINITIONS = [
  // Shared / tenant home and daily work
  { id: "tenantHome", pattern: "/admin", titleKey: "nav.items.home", scope: "shared" },
  { id: "inbox", pattern: "/admin/inbox", titleKey: "nav.items.conversations", scope: "tenant" },
  { id: "conversations", pattern: "/admin/conversations", titleKey: "nav.items.conversations", scope: "tenant", discoverable: false },
  { id: "contacts", pattern: "/admin/contacts", titleKey: "nav.items.crm", scope: "tenant" },
  { id: "contactDetail", pattern: "/admin/contacts/:leadId", titleKey: "navigation.routes.contactDetail", scope: "tenant", parentId: "contacts", dynamicTitleParam: "leadId" },
  { id: "organizations", pattern: "/admin/contacts/organizations", titleKey: "nav.items.organizations", scope: "tenant", parentId: "contacts" },
  { id: "segments", pattern: "/admin/contacts/segments", titleKey: "topbar.breadcrumbs.segments", scope: "tenant", parentId: "contacts" },
  { id: "pipeline", pattern: "/admin/pipeline", titleKey: "nav.items.pipeline", scope: "tenant" },
  { id: "pipelineDealDetail", pattern: "/admin/pipeline/:dealId", titleKey: "navigation.routes.pipelineDealDetail", scope: "tenant", parentId: "pipeline", dynamicTitleParam: "dealId" },

  // AI, knowledge and growth
  { id: "agents", pattern: "/admin/agent", titleKey: "nav.items.aiAgent", scope: "tenant" },
  { id: "agentDetail", pattern: "/admin/agent/:agentId", titleKey: "navigation.routes.agentDetail", scope: "tenant", parentId: "agents", dynamicTitleParam: "agentId" },
  { id: "agentTest", pattern: "/admin/agent/:agentId/test", titleKey: "nav.items.agentSimulation", scope: "tenant", parentId: "agentDetail" },
  { id: "agentSimulation", pattern: "/admin/agent/simulation", titleKey: "nav.items.agentSimulation", scope: "tenant", parentId: "agents" },
  { id: "procedures", pattern: "/admin/procedures", titleKey: "nav.items.procedures", scope: "tenant" },
  { id: "knowledge", pattern: "/admin/knowledge", titleKey: "nav.items.knowledgeBase", scope: "tenant" },
  { id: "knowledgeFaqs", pattern: "/admin/knowledge/faqs", titleKey: "navigation.routes.knowledgeFaqs", scope: "tenant", parentId: "knowledge" },
  { id: "automation", pattern: "/admin/automation", titleKey: "nav.items.automation", scope: "tenant" },
  { id: "dripSequences", pattern: "/admin/automation/drip-sequences", titleKey: "nav.items.dripSequences", scope: "tenant", parentId: "automation" },
  { id: "dripSequenceDetail", pattern: "/admin/automation/drip-sequences/:sequenceId", titleKey: "navigation.routes.dripSequenceDetail", scope: "tenant", parentId: "dripSequences", dynamicTitleParam: "sequenceId" },
  { id: "automationTemplates", pattern: "/admin/automation/templates", titleKey: "nav.items.automationTemplates", scope: "tenant", parentId: "automation" },
  { id: "broadcast", pattern: "/admin/broadcast", titleKey: "nav.items.campaigns", scope: "tenant" },

  // Analytics and governance
  { id: "analytics", pattern: "/admin/analytics-v2", titleKey: "nav.items.analytics", scope: "tenant" },
  { id: "crmAnalytics", pattern: "/admin/crm-analytics", titleKey: "nav.items.crmAnalytics", scope: "tenant" },
  { id: "agentAnalytics", pattern: "/admin/agent-analytics", titleKey: "nav.items.agentAnalytics", scope: "tenant" },
  { id: "attribution", pattern: "/admin/attribution", titleKey: "nav.items.attribution", scope: "tenant" },
  { id: "reportBuilder", pattern: "/admin/report-builder", titleKey: "nav.items.reportBuilder", scope: "tenant" },
  { id: "identity", pattern: "/admin/identity", titleKey: "nav.items.identity", scope: "tenant" },
  { id: "compliance", pattern: "/admin/compliance", titleKey: "nav.items.compliance", scope: "tenant" },
  { id: "featureRequests", pattern: "/admin/feature-requests", titleKey: "nav.items.featureRequests", scope: "shared" },
  { id: "users", pattern: "/admin/users", titleKey: "nav.items.users", scope: "tenant" },

  // Channels
  { id: "channels", pattern: "/admin/channels", titleKey: "nav.items.channels", scope: "tenant" },
  { id: "channelEmail", pattern: "/admin/channels/email", titleKey: "navigation.routes.channelEmail", scope: "tenant", parentId: "channels" },
  { id: "channelInstagram", pattern: "/admin/channels/instagram", titleKey: "navigation.routes.channelInstagram", scope: "tenant", parentId: "channels" },
  { id: "channelInstagramCallback", pattern: "/admin/channels/instagram/callback", titleKey: "navigation.routes.channelInstagramCallback", scope: "tenant", parentId: "channelInstagram", discoverable: false },
  { id: "channelMessenger", pattern: "/admin/channels/messenger", titleKey: "navigation.routes.channelMessenger", scope: "tenant", parentId: "channels" },
  { id: "channelSms", pattern: "/admin/channels/sms", titleKey: "navigation.routes.channelSms", scope: "tenant", parentId: "channels", discoverable: false },
  { id: "channelTelegram", pattern: "/admin/channels/telegram", titleKey: "navigation.routes.channelTelegram", scope: "tenant", parentId: "channels" },
  { id: "channelWhatsapp", pattern: "/admin/channels/whatsapp", titleKey: "navigation.routes.channelWhatsapp", scope: "tenant", parentId: "channels" },
  { id: "channelWhatsappProfile", pattern: "/admin/channels/whatsapp/profile", titleKey: "navigation.routes.channelWhatsappProfile", scope: "tenant", parentId: "channelWhatsapp" },
  { id: "channelWhatsappTemplates", pattern: "/admin/channels/whatsapp/templates", titleKey: "navigation.routes.channelWhatsappTemplates", scope: "tenant", parentId: "channelWhatsapp" },

  // Vertical operations and catalogs
  { id: "appointments", pattern: "/admin/appointments", titleKey: "nav.items.appointments", scope: "tenant" },
  { id: "catalog", pattern: "/admin/catalog", titleKey: "nav.items.catalog", scope: "tenant", discoverable: false },
  { id: "catalogCampaigns", pattern: "/admin/catalog/campaigns", titleKey: "navigation.routes.acquisitionCampaigns", scope: "tenant" },
  { id: "catalogCourses", pattern: "/admin/catalog/courses", titleKey: "nav.items.courses", scope: "tenant", parentId: "courses", discoverable: false },
  { id: "catalogOffers", pattern: "/admin/catalog/offers", titleKey: "nav.items.offers", scope: "tenant" },
  { id: "classes", pattern: "/admin/classes", titleKey: "nav.items.classes", scope: "tenant" },
  { id: "courses", pattern: "/admin/courses", titleKey: "nav.items.courses", scope: "tenant" },
  { id: "foodOrders", pattern: "/admin/food-orders", titleKey: "nav.items.foodOrders", scope: "tenant" },
  { id: "insurance", pattern: "/admin/insurance", titleKey: "nav.items.insurance", scope: "tenant" },
  { id: "inventory", pattern: "/admin/inventory", titleKey: "nav.items.inventory", scope: "tenant" },
  { id: "landings", pattern: "/admin/landings", titleKey: "topbar.breadcrumbs.landings", scope: "tenant" },
  { id: "listings", pattern: "/admin/listings", titleKey: "nav.items.listings", scope: "tenant" },
  { id: "listingDetail", pattern: "/admin/listings/:listingId", titleKey: "navigation.routes.listingDetail", scope: "tenant", parentId: "listings", dynamicTitleParam: "listingId" },
  { id: "memberships", pattern: "/admin/memberships", titleKey: "nav.items.memberships", scope: "tenant" },
  { id: "menu", pattern: "/admin/menu", titleKey: "nav.items.menu", scope: "tenant" },
  { id: "orders", pattern: "/admin/orders", titleKey: "nav.items.orders", scope: "tenant" },
  { id: "pets", pattern: "/admin/pets", titleKey: "nav.items.pets", scope: "tenant" },
  { id: "photoSessions", pattern: "/admin/photo-sessions", titleKey: "nav.items.photoSessions", scope: "tenant" },
  { id: "properties", pattern: "/admin/properties", titleKey: "nav.items.properties", scope: "tenant" },
  { id: "propertyDetail", pattern: "/admin/properties/:propertyId", titleKey: "navigation.routes.propertyDetail", scope: "tenant", parentId: "properties", dynamicTitleParam: "propertyId" },
  { id: "resourceRentals", pattern: "/admin/resource-rentals", titleKey: "nav.items.resourceRentals", scope: "tenant" },
  { id: "serviceRequests", pattern: "/admin/service-requests", titleKey: "nav.items.serviceRequests", scope: "tenant" },
  { id: "tours", pattern: "/admin/tours", titleKey: "nav.items.tours", scope: "tenant" },
  { id: "tourDetail", pattern: "/admin/tours/:packageId", titleKey: "navigation.routes.tourDetail", scope: "tenant", parentId: "tours", dynamicTitleParam: "packageId" },
  { id: "treatmentPlans", pattern: "/admin/treatment-plans", titleKey: "nav.items.treatmentPlans", scope: "tenant" },
  { id: "vehicles", pattern: "/admin/vehicles", titleKey: "nav.items.vehicles", scope: "tenant" },

  // Settings home and personal settings
  { id: "settings", pattern: "/admin/settings", titleKey: "nav.items.settings", scope: "shared", returnFallbackId: "tenantHome" },
  { id: "settingsProfile", pattern: "/admin/settings/profile", titleKey: "settings.items.profile.label", scope: "shared", parentId: "settings" },
  { id: "settingsSecurity", pattern: "/admin/settings/security", titleKey: "settings.items.security.label", scope: "shared", parentId: "settings" },
  { id: "settingsChangePassword", pattern: "/admin/settings/change-password", titleKey: "topbar.breadcrumbs.changePassword", scope: "shared", parentId: "settingsSecurity" },
  { id: "settingsNotifications", pattern: "/admin/settings/notifications", titleKey: "settings.items.notifications.label", scope: "shared", parentId: "settings" },
  { id: "settingsAppearance", pattern: "/admin/settings/appearance", titleKey: "settings.items.appearance.label", scope: "shared", parentId: "settings" },

  // Tenant workspace settings
  { id: "settingsBusinessInfo", pattern: "/admin/settings/business-info", titleKey: "settings.items.businessInfo.label", scope: "tenant", parentId: "settings" },
  { id: "settingsCompany", pattern: "/admin/settings/company", titleKey: "settings.items.companyGeneral.label", scope: "tenant", parentId: "settings", discoverable: false },
  { id: "settingsPolicies", pattern: "/admin/settings/policies", titleKey: "settings.items.policies.label", scope: "tenant", parentId: "settings" },
  { id: "settingsLocalization", pattern: "/admin/settings/localization", titleKey: "settings.items.localization.label", scope: "tenant", parentId: "settings" },
  { id: "settingsFiscal", pattern: "/admin/settings/fiscal", titleKey: "settings.items.fiscal.label", scope: "tenant", parentId: "settings" },
  { id: "settingsBusinessHours", pattern: "/admin/settings/business-hours", titleKey: "settings.items.businessHours.label", scope: "tenant", parentId: "settings" },
  { id: "settingsBilling", pattern: "/admin/settings/billing", titleKey: "nav.items.billing", scope: "tenant", parentId: "settings" },
  { id: "settingsPipeline", pattern: "/admin/settings/pipeline", titleKey: "settings.items.pipelineStages.label", scope: "tenant", parentId: "settings" },
  { id: "settingsScoring", pattern: "/admin/settings/scoring-config", titleKey: "settings.items.scoringConfig.label", scope: "tenant", parentId: "settings" },
  { id: "settingsCustomAttributes", pattern: "/admin/settings/custom-attributes", titleKey: "settings.items.customAttributes.label", scope: "tenant", parentId: "settings" },
  { id: "settingsPrechat", pattern: "/admin/settings/prechat", titleKey: "settings.items.prechat.label", scope: "tenant", parentId: "settings" },
  { id: "settingsPublicBooking", pattern: "/admin/settings/public-booking", titleKey: "settings.items.publicBooking.label", scope: "tenant", parentId: "settings" },
  { id: "settingsNurturing", pattern: "/admin/settings/nurturing", titleKey: "settings.items.nurturing.label", scope: "tenant", parentId: "settings" },
  { id: "settingsEmailTemplates", pattern: "/admin/settings/email-templates", titleKey: "settings.items.emailTemplates.label", scope: "tenant", parentId: "settings" },
  { id: "settingsMacros", pattern: "/admin/settings/macros", titleKey: "settings.items.macros.label", scope: "tenant", parentId: "settings" },
  { id: "settingsMedia", pattern: "/admin/settings/media", titleKey: "settings.items.mediaBank.label", scope: "tenant", parentId: "settings" },
  { id: "settingsRecall", pattern: "/admin/settings/recall", titleKey: "settings.items.recall.label", scope: "tenant", parentId: "settings" },
  { id: "settingsAlerts", pattern: "/admin/settings/alerts", titleKey: "settings.items.alerts.label", scope: "tenant", parentId: "settings" },
  { id: "settingsApiKeys", pattern: "/admin/settings/api-keys", titleKey: "settings.items.apiKeys.label", scope: "tenant", parentId: "settings" },
  { id: "settingsIntegrations", pattern: "/admin/settings/integrations", titleKey: "navigation.routes.settingsIntegrations", scope: "tenant", parentId: "settings", discoverable: false },
  { id: "settingsCrmIntegration", pattern: "/admin/settings/integrations/crm", titleKey: "settings.items.crmIntegrations.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsEcommerce", pattern: "/admin/settings/integrations/ecommerce", titleKey: "settings.items.ecommerce.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsMcp", pattern: "/admin/settings/integrations/mcp", titleKey: "settings.items.mcp.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsPayments", pattern: "/admin/settings/integrations/payments", titleKey: "settings.items.payments.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsReviews", pattern: "/admin/settings/integrations/reviews", titleKey: "settings.items.reviews.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsSlack", pattern: "/admin/settings/integrations/slack", titleKey: "settings.items.slack.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsSmsNotifications", pattern: "/admin/settings/integrations/sms-notifications", titleKey: "settings.items.smsNotifications.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsVerticalIntegrations", pattern: "/admin/settings/integrations/vertical", titleKey: "settings.items.verticalIntegrations.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsWebChat", pattern: "/admin/settings/integrations/web-chat", titleKey: "settings.items.webChat.label", scope: "tenant", parentId: "settingsIntegrations" },
  { id: "settingsWebChatTriggers", pattern: "/admin/settings/integrations/web-chat/triggers", titleKey: "navigation.routes.settingsWebChatTriggers", scope: "tenant", parentId: "settingsWebChat" },
  { id: "settingsWebhooks", pattern: "/admin/settings/integrations/webhooks", titleKey: "settings.items.outboundWebhooks.label", scope: "tenant", parentId: "settingsIntegrations" },

  // Platform console
  { id: "platformTenants", pattern: "/admin/tenants", titleKey: "nav.items.tenants", scope: "platform" },
  { id: "platformTenantDetail", pattern: "/admin/tenants/:tenantId", titleKey: "navigation.routes.platformTenantDetail", scope: "platform", parentId: "platformTenants", dynamicTitleParam: "tenantId" },
  { id: "platformOps", pattern: "/admin/ops", titleKey: "nav.items.ops", scope: "platform" },
  { id: "platformOpsAlerts", pattern: "/admin/ops/alerts", titleKey: "topbar.breadcrumbs.alerts", scope: "platform", parentId: "platformOps" },
  { id: "platformIncidents", pattern: "/admin/incidents", titleKey: "nav.items.incidents", scope: "platform" },
  { id: "platformFinancials", pattern: "/admin/financials", titleKey: "nav.items.financials", scope: "platform" },
  { id: "platformFiscal", pattern: "/admin/fiscal", titleKey: "nav.items.fiscalAdmin", scope: "platform" },
  { id: "platformManaged", pattern: "/admin/managed", titleKey: "nav.items.managed", scope: "platform" },
  { id: "platformUsage", pattern: "/admin/usage", titleKey: "nav.items.platformUsage", scope: "platform" },
  { id: "platformStorage", pattern: "/admin/storage", titleKey: "nav.items.storage", scope: "platform" },
  { id: "platformHealth", pattern: "/admin/health", titleKey: "nav.items.platformHealth", scope: "platform" },
  { id: "platformAudit", pattern: "/admin/audit", titleKey: "nav.items.platformAudit", scope: "platform" },
  { id: "platformLlmStats", pattern: "/admin/llm-stats", titleKey: "nav.items.llmStats", scope: "platform" },
  { id: "platformWebhooks", pattern: "/admin/webhooks", titleKey: "nav.items.webhookTap", scope: "platform" },
  { id: "platformCompliance", pattern: "/admin/compliance-admin", titleKey: "nav.items.complianceAdmin", scope: "platform" },
  { id: "platformFunnel", pattern: "/admin/funnel", titleKey: "nav.items.funnel", scope: "platform" },
  { id: "platformVerticalAnalytics", pattern: "/admin/vertical-analytics", titleKey: "nav.items.verticalAnalytics", scope: "platform" },
  { id: "platformCoupons", pattern: "/admin/coupons", titleKey: "nav.items.coupons", scope: "platform" },
  { id: "platformPlans", pattern: "/admin/plans", titleKey: "nav.items.plans", scope: "platform" },
  { id: "platformBillingOps", pattern: "/admin/billing-ops", titleKey: "nav.items.billingOps", scope: "platform" },
  { id: "platformSmsPackages", pattern: "/admin/sms-packages", titleKey: "nav.items.smsPackages", scope: "platform" },
  { id: "platformSettingsAiConfig", pattern: "/admin/settings/ai-config", titleKey: "settings.items.aiConfig.label", scope: "platform", parentId: "settings" },
  { id: "platformSettingsAiProviders", pattern: "/admin/settings/ai-providers", titleKey: "settings.items.aiProviders.label", scope: "platform", parentId: "settings" },
  { id: "platformSettingsChannels", pattern: "/admin/settings/channels", titleKey: "settings.items.channelConfig.label", scope: "platform", parentId: "settings" },
  { id: "platformSettings", pattern: "/admin/settings/platform", titleKey: "settings.items.advanced.label", scope: "platform", parentId: "settings" },
  { id: "platformSettingsChangelog", pattern: "/admin/settings/platform/changelog", titleKey: "settings.items.changelog.label", scope: "platform", parentId: "platformSettings" },
  { id: "setupWizard", pattern: "/admin/setup-wizard", titleKey: "navigation.routes.setupWizard", scope: "tenant" },
] as const satisfies readonly NavigationRouteDefinition[];

export type NavigationRouteId = (typeof NAVIGATION_ROUTE_DEFINITIONS)[number]["id"];

/** Read-only canonical registry. */
export const NAVIGATION_ROUTES: readonly NavigationRouteDefinition[] = NAVIGATION_ROUTE_DEFINITIONS;

/**
 * Canonical keys owned by this contract. They must exist in all four locale
 * files before a UI consumer renders the corresponding fallback title.
 * Existing keys under nav/topbar/settings are intentionally reused elsewhere.
 */
export const NAVIGATION_I18N_KEYS_REQUIRED = [
  "navigation.routes.acquisitionCampaigns",
  "navigation.routes.agentDetail",
  "navigation.routes.channelEmail",
  "navigation.routes.channelInstagram",
  "navigation.routes.channelInstagramCallback",
  "navigation.routes.channelMessenger",
  "navigation.routes.channelSms",
  "navigation.routes.channelTelegram",
  "navigation.routes.channelWhatsapp",
  "navigation.routes.channelWhatsappProfile",
  "navigation.routes.channelWhatsappTemplates",
  "navigation.routes.contactDetail",
  "navigation.routes.dripSequenceDetail",
  "navigation.routes.knowledgeFaqs",
  "navigation.routes.listingDetail",
  "navigation.routes.pipelineDealDetail",
  "navigation.routes.platformTenantDetail",
  "navigation.routes.propertyDetail",
  "navigation.routes.settingsIntegrations",
  "navigation.routes.settingsWebChatTriggers",
  "navigation.routes.setupWizard",
  "navigation.routes.tourDetail",
] as const;

export interface NavigationTarget {
  href: string;
  /** Defaults to true for /admin and false for every other destination. */
  exact?: boolean;
}

export interface ResolvedNavigationRoute {
  definition: NavigationRouteDefinition;
  pathname: string;
  params: Readonly<Record<string, string>>;
}

export interface NavigationBreadcrumb {
  routeId: string;
  href: string;
  titleKey: string;
  /** Entity label, when resolved. Consumers translate titleKey otherwise. */
  label?: string;
  isCurrent: boolean;
}

export interface BuildNavigationBreadcrumbsOptions {
  dynamicLabels?: Readonly<Partial<Record<NavigationRouteId, string>>>;
  resolveDynamicLabel?: (
    route: NavigationRouteDefinition,
    params: Readonly<Record<string, string>>,
  ) => string | null | undefined;
}

const ROUTES_BY_ID = new Map(NAVIGATION_ROUTES.map((route) => [route.id, route]));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normalizes a Next pathname while ignoring search/hash state. */
export function normalizeNavigationPath(value: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) return null;

  const pathname = trimmed.split(/[?#]/, 1)[0];
  if (!pathname || /\/{2,}/.test(pathname)) return null;
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

/** Prefix matching that respects path segment boundaries. */
export function isSegmentAwareNavigationMatch(
  pathname: string,
  targetHref: string,
  exact = false,
): boolean {
  const current = normalizeNavigationPath(pathname);
  const target = normalizeNavigationPath(targetHref);
  if (!current || !target) return false;
  if (exact) return current === target;
  return current === target || current.startsWith(`${target}/`);
}

/**
 * Selects the most specific matching destination. This prevents parent links
 * and shorter, similarly-named links from competing for the active state.
 */
export function selectActiveNavigationTarget<T extends NavigationTarget>(
  pathname: string,
  targets: readonly T[],
): T | null {
  const matches = targets
    .map((target, index) => ({ target, index, href: normalizeNavigationPath(target.href) }))
    .filter((entry): entry is { target: T; index: number; href: string } => {
      if (!entry.href) return false;
      const exact = entry.target.exact ?? entry.href === "/admin";
      return isSegmentAwareNavigationMatch(pathname, entry.href, exact);
    });

  matches.sort((a, b) => {
    const segmentDelta = pathSegments(b.href).length - pathSegments(a.href).length;
    if (segmentDelta !== 0) return segmentDelta;
    const lengthDelta = b.href.length - a.href.length;
    return lengthDelta !== 0 ? lengthDelta : a.index - b.index;
  });

  return matches[0]?.target ?? null;
}

export function getNavigationRoute(routeId: NavigationRouteId | string): NavigationRouteDefinition | null {
  return ROUTES_BY_ID.get(routeId) ?? null;
}

/** Resolves a canonical definition, preferring static routes over parameters. */
export function resolveNavigationRoute(pathname: string): ResolvedNavigationRoute | null {
  const normalized = normalizeNavigationPath(pathname);
  if (!normalized) return null;

  const matches = NAVIGATION_ROUTES.flatMap((definition, index) => {
    const params = matchRoutePattern(definition.pattern, normalized);
    return params ? [{ definition, params, index }] : [];
  });

  matches.sort((a, b) => {
    const specificityDelta = routeSpecificity(b.definition.pattern) - routeSpecificity(a.definition.pattern);
    return specificityDelta !== 0 ? specificityDelta : a.index - b.index;
  });

  const match = matches[0];
  return match ? { definition: match.definition, pathname: normalized, params: match.params } : null;
}

/**
 * Builds breadcrumbs from semantic parent metadata. Unknown paths return an
 * empty list instead of exposing URL slugs or identifiers to the user.
 */
export function buildNavigationBreadcrumbs(
  pathname: string,
  options: BuildNavigationBreadcrumbsOptions = {},
): NavigationBreadcrumb[] {
  const resolved = resolveNavigationRoute(pathname);
  if (!resolved) return [];

  const chain: NavigationRouteDefinition[] = [];
  const visited = new Set<string>();
  let cursor: NavigationRouteDefinition | null = resolved.definition;

  while (cursor && !visited.has(cursor.id)) {
    chain.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.parentId ? getNavigationRoute(cursor.parentId) : null;
  }

  return chain.map((route, index) => {
    const href = materializeRoutePattern(route.pattern, resolved.params) ?? resolved.pathname;
    const dynamicLabel = route.dynamicTitleParam
      ? sanitizeDynamicLabel(
          options.dynamicLabels?.[route.id as NavigationRouteId]
            ?? options.resolveDynamicLabel?.(route, resolved.params),
        )
      : undefined;

    return {
      routeId: route.id,
      href,
      titleKey: route.titleKey,
      ...(dynamicLabel ? { label: dynamicLabel } : {}),
      isCurrent: index === chain.length - 1,
    };
  });
}

export interface SafeReturnToOptions {
  allowRouteIds?: readonly (NavigationRouteId | string)[];
  allowScopes?: readonly NavigationScope[];
  isAllowedPath?: (pathname: string, route: NavigationRouteDefinition) => boolean;
}

/**
 * Accepts only relative, canonical dashboard URLs. It rejects external URLs,
 * protocol-relative URLs, encoded traversal/separators and unknown pages.
 */
export function sanitizeInternalReturnTo(
  candidate: string | null | undefined,
  options: SafeReturnToOptions = {},
): string | null {
  if (!candidate || typeof candidate !== "string") return null;
  const raw = candidate.trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;

  const rawPath = raw.split(/[?#]/, 1)[0];
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  if (decodedPath.includes("\\") || decodedPath.includes("//")) return null;
  if (decodedPath.split("/").some((segment) => segment === "." || segment === "..")) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, "https://navigation.parallly.invalid");
  } catch {
    return null;
  }

  if (parsed.origin !== "https://navigation.parallly.invalid") return null;
  const pathname = normalizeNavigationPath(parsed.pathname);
  if (!pathname || (pathname !== "/admin" && !pathname.startsWith("/admin/"))) return null;

  const resolved = resolveNavigationRoute(pathname);
  if (!resolved) return null;

  if (options.allowRouteIds && !options.allowRouteIds.includes(resolved.definition.id)) return null;
  if (options.allowScopes && !options.allowScopes.includes(resolved.definition.scope)) return null;
  if (options.isAllowedPath && !options.isAllowedPath(pathname, resolved.definition)) return null;

  return `${pathname}${parsed.search}${parsed.hash}`;
}

export type NavigationReturnSource =
  | "returnTo"
  | "configured-fallback"
  | "semantic-parent"
  | "scope-home"
  | "default";

export interface NavigationReturnResolution {
  href: string;
  routeId: string;
  source: NavigationReturnSource;
}

export interface ResolveNavigationReturnOptions extends SafeReturnToOptions {
  currentPath: string;
  returnTo?: string | null;
  /** Context-specific fallback, used before the registered semantic parent. */
  fallbackRouteId?: NavigationRouteId | string;
}

/** Resolves contextual back navigation with a safe semantic fallback chain. */
export function resolveNavigationReturnTarget(
  options: ResolveNavigationReturnOptions,
): NavigationReturnResolution {
  const current = resolveNavigationRoute(options.currentPath);
  const currentPath = normalizeNavigationPath(options.currentPath);
  const safeOptions: SafeReturnToOptions = {
    allowRouteIds: options.allowRouteIds,
    allowScopes: options.allowScopes,
    isAllowedPath: options.isAllowedPath,
  };

  const contextual = sanitizeInternalReturnTo(options.returnTo, safeOptions);
  if (contextual) {
    const contextualPath = normalizeNavigationPath(contextual);
    if (contextualPath && contextualPath !== currentPath) {
      const route = resolveNavigationRoute(contextualPath)!;
      return { href: contextual, routeId: route.definition.id, source: "returnTo" };
    }
  }

  const candidates: Array<{ routeId: string | undefined; source: NavigationReturnSource }> = [
    { routeId: options.fallbackRouteId, source: "configured-fallback" },
    { routeId: current?.definition.returnFallbackId, source: "configured-fallback" },
    { routeId: current?.definition.parentId, source: "semantic-parent" },
    {
      routeId: current?.definition.scope === "platform" ? "platformTenants" : "tenantHome",
      source: "scope-home",
    },
    { routeId: "tenantHome", source: "default" },
  ];

  for (const candidate of candidates) {
    if (!candidate.routeId) continue;
    const definition = getNavigationRoute(candidate.routeId);
    if (!definition) continue;
    const href = materializeRoutePattern(definition.pattern, current?.params ?? {});
    if (!href || href === currentPath) continue;
    const safeHref = sanitizeInternalReturnTo(href, safeOptions);
    if (safeHref) return { href: safeHref, routeId: definition.id, source: candidate.source };
  }

  // /admin is accessible to every authenticated dashboard role by contract.
  return { href: "/admin", routeId: "tenantHome", source: "default" };
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function matchRoutePattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternSegments = pathSegments(pattern);
  const pathParts = pathSegments(pathname);
  if (patternSegments.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(actual);
      } catch {
        return null;
      }
      if (!decoded || decoded.includes("/") || decoded.includes("\\")) return null;
      params[expected.slice(1)] = decoded;
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function routeSpecificity(pattern: string): number {
  const segments = pathSegments(pattern);
  const staticCount = segments.filter((segment) => !segment.startsWith(":")).length;
  return staticCount * 10_000 + segments.length * 100 + pattern.length;
}

function materializeRoutePattern(
  pattern: string,
  params: Readonly<Record<string, string>>,
): string | null {
  const parts = pathSegments(pattern).map((segment) => {
    if (!segment.startsWith(":")) return segment;
    const value = params[segment.slice(1)];
    return value ? encodeURIComponent(value) : null;
  });
  if (parts.some((part) => part === null)) return null;
  return `/${parts.join("/")}`;
}

function sanitizeDynamicLabel(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim();
  if (!label || UUID_PATTERN.test(label)) return undefined;
  return label;
}
