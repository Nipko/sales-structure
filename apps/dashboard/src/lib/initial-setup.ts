export const CERTIFIED_SETUP_CHANNELS = ["whatsapp", "instagram", "messenger", "telegram", "web_chat"] as const;
type CertifiedSetupChannel = typeof CERTIFIED_SETUP_CHANNELS[number];

const CHANNEL_ROUTES: Partial<Record<CertifiedSetupChannel, string>> = {
  whatsapp: "/admin/channels/whatsapp",
  instagram: "/admin/channels/instagram",
  messenger: "/admin/channels/messenger",
  telegram: "/admin/channels/telegram",
};

export interface InitialSetupStatus {
  hasPersona?: boolean;
  hasKnowledge?: boolean;
  hasVerticalCatalog?: boolean | null;
  verticalCatalogRoute?: string | null;
  setupWizardChannels?: string[];
}

export interface EssentialSetupItem {
  key: "agent" | "channel" | "knowledge" | "catalog";
  href: string;
  done: boolean;
}

export interface ResolvedInitialSetupSources {
  status: InitialSetupStatus;
  planChannels: string[];
  activeChannels: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Fail closed: an unavailable source must never become a fabricated pending task. */
export function resolveInitialSetupSources(
  statusResponse: unknown,
  planResponse: unknown,
  channelsResponse: unknown,
): ResolvedInitialSetupSources {
  if (!isRecord(statusResponse) || statusResponse.success !== true || !isRecord(statusResponse.data)) {
    throw new Error("setup_status_unavailable");
  }
  if (!isRecord(planResponse) || planResponse.success !== true || !isRecord(planResponse.data)) {
    throw new Error("plan_features_unavailable");
  }
  if (!Array.isArray(planResponse.data.channels) || !planResponse.data.channels.every((channel) => typeof channel === "string")) {
    throw new Error("plan_channels_invalid");
  }
  if (!isRecord(channelsResponse) || channelsResponse.success !== true || !Array.isArray(channelsResponse.data)) {
    throw new Error("channel_overview_unavailable");
  }
  if (!channelsResponse.data.every((channel) => isRecord(channel)
    && typeof channel.channelType === "string"
    && typeof channel.isActive === "boolean")) {
    throw new Error("channel_overview_invalid");
  }

  return {
    status: statusResponse.data as InitialSetupStatus,
    planChannels: [...planResponse.data.channels],
    activeChannels: channelsResponse.data
      .filter((channel) => (channel as Record<string, unknown>).isActive === true)
      .map((channel) => String((channel as Record<string, unknown>).channelType)),
  };
}

interface BuildEssentialSetupItemsInput {
  status: InitialSetupStatus;
  planChannels: readonly string[];
  activeChannels: readonly string[];
  canAccess: (href: string) => boolean;
}

function canonicalChannel(channel: string): string {
  return channel === "webchat" || channel === "web_widget" ? "web_chat" : channel;
}

export function buildEssentialSetupItems({
  status,
  planChannels,
  activeChannels,
  canAccess,
}: BuildEssentialSetupItemsInput): EssentialSetupItem[] {
  const items: EssentialSetupItem[] = [];

  if (canAccess("/admin/agent")) {
    items.push({ key: "agent", href: "/admin/agent", done: status.hasPersona === true });
  }

  const availableChannels = new Set(planChannels.map(canonicalChannel));
  const certifiedAvailable = CERTIFIED_SETUP_CHANNELS.filter((channel) => availableChannels.has(channel));
  if (certifiedAvailable.length > 0 && canAccess("/admin/channels")) {
    const preferred = (status.setupWizardChannels || [])
      .map(canonicalChannel)
      .find((channel): channel is CertifiedSetupChannel => certifiedAvailable.includes(channel as CertifiedSetupChannel));
    const target = preferred || certifiedAvailable[0];
    const route = CHANNEL_ROUTES[target] || "/admin/channels";
    const connected = new Set(activeChannels.map(canonicalChannel));
    items.push({
      key: "channel",
      href: canAccess(route) ? route : "/admin/channels",
      done: certifiedAvailable.some((channel) => connected.has(channel)),
    });
  }

  const catalogRoute = status.verticalCatalogRoute;
  if (catalogRoute?.startsWith("/admin") && !catalogRoute.startsWith("//") && canAccess(catalogRoute)) {
    items.push({ key: "catalog", href: catalogRoute, done: status.hasVerticalCatalog === true });
  } else if (!catalogRoute && canAccess("/admin/knowledge")) {
    items.push({ key: "knowledge", href: "/admin/knowledge", done: status.hasKnowledge === true });
  }

  return items;
}
