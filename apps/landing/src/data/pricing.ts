import { formatChannelNames, type ApiPlan } from "../lib/api";

export type FeatureCategory =
  | "communication"
  | "aiAgents"
  | "crmSales"
  | "booking"
  | "analytics"
  | "modules"
  | "enterprise";

export type FeatureFmt = "num" | "numDash" | "perMonth" | "bool" | "minutes" | "storage" | "retention" | "channels";

export interface FeatureRow {
  key: string;
  category: FeatureCategory;
  // Every comparison value comes from the live billing plan. No commercial
  // value is silently substituted when the catalog is unavailable.
  //   'top:maxAgents'                        → plan.maxAgents
  //   'feat:customPrompt'                    → plan.features.customPrompt
  //   'feat:mediaProcessing.audioPerMonth'   → nested path in plan.features
  //   'special:aiQuality'                    → derived from features.llmTier
  src: string;
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
  { key: "channels", category: "communication", src: "feat:channels", fmt: "channels" },
  { key: "aiMessages", category: "communication", src: "top:maxAiMessages", fmt: "perMonth" },
  { key: "audioMonth", category: "communication", src: "feat:mediaProcessing.audioPerMonth", fmt: "perMonth" },
  { key: "imageMonth", category: "communication", src: "feat:mediaProcessing.imagePerMonth", fmt: "perMonth" },
  { key: "maxAudioSec", category: "communication", src: "feat:mediaProcessing.maxAudioDurationSec", fmt: "minutes" },

  // AI Agents
  { key: "agents", category: "aiAgents", src: "top:maxAgents", fmt: "num" },
  { key: "aiQuality", category: "aiAgents", src: "special:aiQuality" },
  { key: "customPrompt", category: "aiAgents", src: "feat:customPrompt", fmt: "bool" },
  { key: "customTemplates", category: "aiAgents", src: "feat:customTemplates", fmt: "bool" },
  { key: "aiInsights", category: "aiAgents", src: "feat:aiInsights", fmt: "bool" },
  { key: "recall", category: "aiAgents", src: "feat:recall", fmt: "bool" },

  // CRM & Sales
  { key: "contacts", category: "crmSales", src: "feat:maxContacts", fmt: "num" },
  { key: "pipelineStages", category: "crmSales", src: "feat:pipelineStages", fmt: "num" },
  { key: "automationRules", category: "crmSales", src: "feat:automationRules", fmt: "numDash" },
  { key: "broadcastCampaigns", category: "crmSales", src: "feat:broadcastCampaigns", fmt: "numDash" },
  { key: "segments", category: "crmSales", src: "feat:segments", fmt: "numDash" },
  { key: "customAttributes", category: "crmSales", src: "feat:customAttributes", fmt: "numDash" },
  { key: "externalCrm", category: "crmSales", src: "feat:externalCrm", fmt: "numDash" },
  { key: "outboundWebhooks", category: "crmSales", src: "feat:outboundWebhooks", fmt: "numDash" },

  // Booking
  { key: "calendars", category: "booking", src: "feat:maxCalendars", fmt: "num" },
  { key: "services", category: "booking", src: "feat:appointmentsServices", fmt: "num" },

  // Analytics
  { key: "scheduledReports", category: "analytics", src: "feat:scheduledReports", fmt: "bool" },
  { key: "biApi", category: "analytics", src: "feat:biApi", fmt: "bool" },

  // Modules & Integrations
  { key: "widget", category: "modules", src: "feat:widget", fmt: "bool" },
  { key: "ecommerce", category: "modules", src: "feat:ecommerce", fmt: "bool" },
  { key: "staffScheduling", category: "modules", src: "feat:staffScheduling", fmt: "bool" },
  { key: "vehicleInventory", category: "modules", src: "feat:vehicleInventory", fmt: "bool" },
  { key: "channelManager", category: "modules", src: "feat:channelManager", fmt: "bool" },

  // Enterprise
  { key: "seats", category: "enterprise", src: "feat:seats", fmt: "num" },
  { key: "storage", category: "enterprise", src: "feat:mediaStorageMb", fmt: "storage" },
  { key: "dataRetention", category: "enterprise", src: "feat:dataRetentionDays", fmt: "retention" },
  { key: "knowledgeArticles", category: "enterprise", src: "feat:knowledgeArticles", fmt: "num" },
  { key: "emailTemplates", category: "enterprise", src: "feat:emailTemplates", fmt: "num" },
  { key: "sso", category: "enterprise", src: "feat:sso", fmt: "bool" },
  { key: "auditLog", category: "enterprise", src: "feat:auditLog", fmt: "bool" },
  { key: "customDomainKb", category: "enterprise", src: "feat:customDomainKb", fmt: "bool" },
  { key: "prioritySupport", category: "enterprise", src: "feat:prioritySupport", fmt: "bool" },
  { key: "whiteLabel", category: "enterprise", src: "feat:whiteLabel", fmt: "bool" },
];

const TIER_TO_QUALITY: Record<string, string> = {
  tier_4: "basic", tier_3: "good", tier_2: "advanced", tier_1: "premium",
};

function readFeatureSrc(plan: ApiPlan, src: string): unknown {
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

function formatFeatureValue(raw: unknown, fmt: FeatureFmt | undefined, locale: string): string | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  switch (fmt) {
    case "bool": return raw ? "true" : "false";
    case "num": return n === -1 ? "unlimited" : Number.isFinite(n) ? number(n) : null;
    case "numDash": return n === -1 ? "unlimited" : n === 0 ? "—" : Number.isFinite(n) ? number(n) : null;
    case "perMonth": return n === -1 ? "unlimited" : Number.isFinite(n) ? number(n) : null;
    case "minutes": return Number.isFinite(n)
      ? new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "short" }).format(Math.round(n / 60))
      : null;
    case "storage": return Number.isFinite(n) ? (n >= 1024 ? `${number(Math.round(n / 1024))} GB` : `${number(n)} MB`) : null;
    case "retention": return Number.isFinite(n)
      ? new Intl.NumberFormat(locale, {
          style: "unit",
          unit: n >= 365 ? "year" : "day",
          unitDisplay: "short",
        }).format(n >= 365 ? Math.round(n / 365) : n)
      : null;
    case "channels": return Array.isArray(raw) && raw.every((channel) => typeof channel === "string")
      ? formatChannelNames(raw)
      : null;
    default: return typeof raw === "string" ? raw : String(raw);
  }
}

/**
 * Live display value for a feature row, read from an ApiPlan (billing_plans).
 * Missing/unreadable values are rendered as unavailable, never replaced with
 * a hardcoded commercial promise.
 */
export function resolveFeatureValue(
  plan: ApiPlan | undefined,
  row: FeatureRow,
  locale: string,
): string {
  if (!plan) return "—";
  return formatFeatureValue(readFeatureSrc(plan, row.src), row.fmt, locale) ?? "—";
}
