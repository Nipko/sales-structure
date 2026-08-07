export interface PlanDef {
  slug: string;
  nameKey: string;
  priceUsd: number;
  priceCopMonthly: string;
  priceCopAnnual: string;
  trialDays: number;
  requiresCard: boolean;
  highlighted: boolean;
  badgeKey?: string;
  maxAgents: number;
  maxAiMessages: string;
}

export const PLANS: PlanDef[] = [
  {
    slug: "emprendedor",
    nameKey: "emprendedor",
    priceUsd: 21,
    priceCopMonthly: "$125.700",
    priceCopAnnual: "$105.000",
    trialDays: 7,
    requiresCard: false,
    highlighted: false,
    maxAgents: 1,
    maxAiMessages: "1.000",
  },
  {
    slug: "starter",
    nameKey: "starter",
    priceUsd: 49,
    priceCopMonthly: "$276.900",
    priceCopAnnual: "$229.800",
    trialDays: 7,
    requiresCard: false,
    highlighted: false,
    maxAgents: 1,
    maxAiMessages: "5.000",
  },
  {
    slug: "pro",
    nameKey: "pro",
    priceUsd: 129,
    priceCopMonthly: "$757.700",
    priceCopAnnual: "$628.900",
    trialDays: 15,
    requiresCard: true,
    highlighted: true,
    badgeKey: "popular",
    maxAgents: 3,
    maxAiMessages: "25.000",
  },
  {
    slug: "enterprise",
    nameKey: "enterprise",
    priceUsd: 349,
    priceCopMonthly: "$1.789.800",
    priceCopAnnual: "$1.499.000",
    trialDays: 15,
    requiresCard: true,
    highlighted: false,
    maxAgents: 10,
    maxAiMessages: "100.000",
  },
];

export type FeatureCategory =
  | "communication"
  | "aiAgents"
  | "crmSales"
  | "booking"
  | "analytics"
  | "modules"
  | "enterprise";

export type FeatureFmt = "num" | "numDash" | "perMonth" | "bool" | "minutes" | "storage" | "retention";

export interface FeatureRow {
  key: string;
  category: FeatureCategory;
  // Fallback display values — used at build time and if the API is unreachable.
  values: [string, string, string, string]; // [emprendedor, starter, pro, enterprise]
  // Where to read the LIVE value from an ApiPlan (billing_plans) and how to
  // format it. When absent (e.g. marketing-only rows like `channels`), the
  // hardcoded `values` are always used.
  //   'top:maxAgents'                        → plan.maxAgents
  //   'feat:customPrompt'                    → plan.features.customPrompt
  //   'feat:mediaProcessing.audioPerMonth'   → nested path in plan.features
  //   'special:aiQuality'                    → derived from features.llmTier
  src?: string;
  fmt?: FeatureFmt;
}

export const FEATURE_CATEGORIES: { key: FeatureCategory; labelKey: string }[] = [
  { key: "communication", labelKey: "catCommunication" },
  { key: "aiAgents", labelKey: "catAiAgents" },
  { key: "crmSales", labelKey: "catCrmSales" },
  { key: "booking", labelKey: "catBooking" },
  { key: "analytics", labelKey: "catAnalytics" },
  { key: "modules", labelKey: "catModules" },
  { key: "enterprise", labelKey: "catEnterprise" },
];

/** Minimum capacity required by every canonical vertical bootstrap. */
export const VERTICAL_BOOTSTRAP_PLAN_FLOORS = {
  emprendedor: { pipelineStages: 7, appointmentsServices: 4 },
  starter: { pipelineStages: 7, appointmentsServices: 4 },
} as const;

export const FEATURE_MATRIX: FeatureRow[] = [
  // Communication
  { key: "channels", category: "communication", values: ["1 (WhatsApp)", "4 (WA+IG+Messenger+Email)", "6 (Todos)", "6 (Todos)"] },
  { key: "aiMessages", category: "communication", values: ["1.000/mes", "5.000/mes", "25.000/mes", "100.000/mes"], src: "top:maxAiMessages", fmt: "perMonth" },
  { key: "audioMonth", category: "communication", values: ["30/mes", "150/mes", "500/mes", "2.000/mes"], src: "feat:mediaProcessing.audioPerMonth", fmt: "perMonth" },
  { key: "imageMonth", category: "communication", values: ["50/mes", "250/mes", "1.000/mes", "5.000/mes"], src: "feat:mediaProcessing.imagePerMonth", fmt: "perMonth" },
  { key: "maxAudioSec", category: "communication", values: ["2 min", "3 min", "5 min", "5 min"], src: "feat:mediaProcessing.maxAudioDurationSec", fmt: "minutes" },

  // AI Agents
  { key: "agents", category: "aiAgents", values: ["1", "1", "3", "10"], src: "top:maxAgents", fmt: "num" },
  { key: "aiQuality", category: "aiAgents", values: ["basic", "good", "advanced", "premium"], src: "special:aiQuality" },
  { key: "customPrompt", category: "aiAgents", values: ["false", "false", "true", "true"], src: "feat:customPrompt", fmt: "bool" },
  { key: "customTemplates", category: "aiAgents", values: ["false", "false", "true", "true"], src: "feat:customTemplates", fmt: "bool" },
  { key: "aiInsights", category: "aiAgents", values: ["false", "false", "true", "true"], src: "feat:aiInsights", fmt: "bool" },
  { key: "recall", category: "aiAgents", values: ["false", "false", "true", "true"], src: "feat:recall", fmt: "bool" },

  // CRM & Sales
  { key: "contacts", category: "crmSales", values: ["100", "500", "5.000", "50.000"], src: "feat:maxContacts", fmt: "num" },
  { key: "pipelineStages", category: "crmSales", values: [String(VERTICAL_BOOTSTRAP_PLAN_FLOORS.emprendedor.pipelineStages), String(VERTICAL_BOOTSTRAP_PLAN_FLOORS.starter.pipelineStages), "15", "unlimited"], src: "feat:pipelineStages", fmt: "num" },
  { key: "automationRules", category: "crmSales", values: ["—", "5", "unlimited", "unlimited"], src: "feat:automationRules", fmt: "numDash" },
  { key: "broadcastCampaigns", category: "crmSales", values: ["—", "3", "unlimited", "unlimited"], src: "feat:broadcastCampaigns", fmt: "numDash" },
  { key: "segments", category: "crmSales", values: ["—", "3", "15", "unlimited"], src: "feat:segments", fmt: "numDash" },
  { key: "customAttributes", category: "crmSales", values: ["—", "5", "20", "unlimited"], src: "feat:customAttributes", fmt: "numDash" },
  { key: "externalCrm", category: "crmSales", values: ["—", "—", "1", "unlimited"], src: "feat:externalCrm", fmt: "numDash" },
  { key: "outboundWebhooks", category: "crmSales", values: ["—", "—", "3", "unlimited"], src: "feat:outboundWebhooks", fmt: "numDash" },

  // Booking
  { key: "calendars", category: "booking", values: ["1", "1", "3", "10"], src: "feat:maxCalendars", fmt: "num" },
  { key: "services", category: "booking", values: [String(VERTICAL_BOOTSTRAP_PLAN_FLOORS.emprendedor.appointmentsServices), String(VERTICAL_BOOTSTRAP_PLAN_FLOORS.starter.appointmentsServices), "unlimited", "unlimited"], src: "feat:appointmentsServices", fmt: "num" },

  // Analytics
  { key: "scheduledReports", category: "analytics", values: ["false", "false", "true", "true"], src: "feat:scheduledReports", fmt: "bool" },
  { key: "biApi", category: "analytics", values: ["false", "false", "true", "true"], src: "feat:biApi", fmt: "bool" },

  // Modules & Integrations
  { key: "widget", category: "modules", values: ["false", "true", "true", "true"], src: "feat:widget", fmt: "bool" },
  { key: "ecommerce", category: "modules", values: ["false", "true", "true", "true"], src: "feat:ecommerce", fmt: "bool" },
  { key: "staffScheduling", category: "modules", values: ["false", "false", "true", "true"], src: "feat:staffScheduling", fmt: "bool" },
  { key: "vehicleInventory", category: "modules", values: ["false", "false", "true", "true"], src: "feat:vehicleInventory", fmt: "bool" },
  { key: "channelManager", category: "modules", values: ["false", "false", "false", "true"], src: "feat:channelManager", fmt: "bool" },

  // Enterprise
  { key: "seats", category: "enterprise", values: ["1", "3", "5", "unlimited"], src: "feat:seats", fmt: "num" },
  { key: "storage", category: "enterprise", values: ["50 MB", "100 MB", "1 GB", "10 GB"], src: "feat:mediaStorageMb", fmt: "storage" },
  { key: "dataRetention", category: "enterprise", values: ["90d", "180d", "1y", "2y"], src: "feat:dataRetentionDays", fmt: "retention" },
  { key: "knowledgeArticles", category: "enterprise", values: ["5", "20", "unlimited", "unlimited"], src: "feat:knowledgeArticles", fmt: "num" },
  { key: "emailTemplates", category: "enterprise", values: ["2", "4", "20", "unlimited"], src: "feat:emailTemplates", fmt: "num" },
  { key: "sso", category: "enterprise", values: ["false", "false", "false", "true"], src: "feat:sso", fmt: "bool" },
  { key: "auditLog", category: "enterprise", values: ["false", "false", "false", "true"], src: "feat:auditLog", fmt: "bool" },
  { key: "customDomainKb", category: "enterprise", values: ["false", "false", "false", "true"], src: "feat:customDomainKb", fmt: "bool" },
  { key: "prioritySupport", category: "enterprise", values: ["false", "false", "false", "true"], src: "feat:prioritySupport", fmt: "bool" },
  { key: "whiteLabel", category: "enterprise", values: ["false", "false", "false", "custom"] },
];

const TIER_TO_QUALITY: Record<string, string> = {
  tier_4: "basic", tier_3: "good", tier_2: "advanced", tier_1: "premium",
};

function readFeatureSrc(plan: import("../lib/api").ApiPlan, src: string): unknown {
  const sep = src.indexOf(":");
  const kind = src.slice(0, sep);
  const path = src.slice(sep + 1);
  if (kind === "top") return (plan as unknown as Record<string, unknown>)[path];
  if (kind === "special") return path === "aiQuality" ? TIER_TO_QUALITY[String(plan.features?.llmTier)] : undefined;
  if (kind === "feat") {
    return path.split(".").reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      plan.features,
    );
  }
  return undefined;
}

function formatFeatureValue(raw: unknown, fmt?: FeatureFmt): string | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  switch (fmt) {
    case "bool": return raw ? "true" : "false";
    case "num": return n === -1 ? "unlimited" : n.toLocaleString("es-CO");
    case "numDash": return n === -1 ? "unlimited" : n === 0 ? "—" : n.toLocaleString("es-CO");
    case "perMonth": return n === -1 ? "unlimited" : `${n.toLocaleString("es-CO")}/mes`;
    case "minutes": return `${Math.round(n / 60)} min`;
    case "storage": return n >= 1024 ? `${Math.round(n / 1024)} GB` : `${n} MB`;
    case "retention": return n >= 365 ? `${Math.round(n / 365)}y` : `${n}d`;
    default: return typeof raw === "string" ? raw : String(raw);
  }
}

/**
 * Live display value for a feature row, read from an ApiPlan (billing_plans).
 * Falls back to the hardcoded `values[planIndex]` when there is no API plan or
 * the source is absent/unreadable — so the table never breaks.
 */
export function resolveFeatureValue(
  plan: import("../lib/api").ApiPlan | undefined,
  row: FeatureRow,
  planIndex: number,
): string {
  const fallback = row.values[planIndex];
  if (!plan || !row.src) return fallback;
  const formatted = formatFeatureValue(readFeatureSrc(plan, row.src), row.fmt);
  return formatted ?? fallback;
}

export interface UpsellDef {
  fromPlan: string;
  toPlan: string;
  highlightKeys: string[];
}

export const UPSELLS: UpsellDef[] = [
  {
    fromPlan: "emprendedor",
    toPlan: "starter",
    highlightKeys: ["upsellEmpToStarter1", "upsellEmpToStarter2"],
  },
  {
    fromPlan: "starter",
    toPlan: "pro",
    highlightKeys: ["upsellStarterToPro1", "upsellStarterToPro2"],
  },
  {
    fromPlan: "pro",
    toPlan: "enterprise",
    highlightKeys: ["upsellProToEnt1", "upsellProToEnt2"],
  },
];
