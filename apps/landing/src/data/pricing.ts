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
    priceCopMonthly: "$215.800",
    priceCopAnnual: "$179.000",
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
    priceCopMonthly: "$679.500",
    priceCopAnnual: "$569.000",
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
  | "enterprise";

export interface FeatureRow {
  key: string;
  category: FeatureCategory;
  values: [string, string, string, string]; // [emprendedor, starter, pro, enterprise]
}

export const FEATURE_CATEGORIES: { key: FeatureCategory; labelKey: string }[] = [
  { key: "communication", labelKey: "catCommunication" },
  { key: "aiAgents", labelKey: "catAiAgents" },
  { key: "crmSales", labelKey: "catCrmSales" },
  { key: "booking", labelKey: "catBooking" },
  { key: "analytics", labelKey: "catAnalytics" },
  { key: "enterprise", labelKey: "catEnterprise" },
];

export const FEATURE_MATRIX: FeatureRow[] = [
  // Communication
  { key: "channels", category: "communication", values: ["1 (WhatsApp)", "3 (WA+IG+Messenger)", "5 (Todos)", "5 (Todos)"] },
  { key: "aiMessages", category: "communication", values: ["1.000/mes", "5.000/mes", "25.000/mes", "100.000/mes"] },
  { key: "audioMonth", category: "communication", values: ["30/mes", "150/mes", "500/mes", "2.000/mes"] },
  { key: "imageMonth", category: "communication", values: ["50/mes", "250/mes", "1.000/mes", "5.000/mes"] },
  { key: "maxAudioSec", category: "communication", values: ["2 min", "3 min", "5 min", "5 min"] },

  // AI Agents
  { key: "agents", category: "aiAgents", values: ["1", "1", "3", "10"] },
  { key: "aiQuality", category: "aiAgents", values: ["basic", "good", "advanced", "premium"] },
  { key: "customPrompt", category: "aiAgents", values: ["false", "false", "true", "true"] },
  { key: "customTemplates", category: "aiAgents", values: ["false", "false", "true", "true"] },
  { key: "aiInsights", category: "aiAgents", values: ["false", "false", "true", "true"] },
  { key: "recall", category: "aiAgents", values: ["false", "false", "true", "true"] },

  // CRM & Sales
  { key: "contacts", category: "crmSales", values: ["100", "500", "5.000", "50.000"] },
  { key: "pipelineStages", category: "crmSales", values: ["3", "5", "15", "unlimited"] },
  { key: "automationRules", category: "crmSales", values: ["—", "5", "unlimited", "unlimited"] },
  { key: "broadcastCampaigns", category: "crmSales", values: ["—", "3", "unlimited", "unlimited"] },
  { key: "segments", category: "crmSales", values: ["—", "3", "15", "unlimited"] },
  { key: "customAttributes", category: "crmSales", values: ["—", "5", "20", "unlimited"] },
  { key: "externalCrm", category: "crmSales", values: ["—", "—", "1", "unlimited"] },
  { key: "outboundWebhooks", category: "crmSales", values: ["—", "—", "3", "unlimited"] },

  // Booking
  { key: "calendars", category: "booking", values: ["1", "1", "3", "10"] },
  { key: "services", category: "booking", values: ["1", "2", "unlimited", "unlimited"] },

  // Analytics
  { key: "scheduledReports", category: "analytics", values: ["false", "false", "true", "true"] },
  { key: "biApi", category: "analytics", values: ["false", "false", "true", "true"] },

  // Enterprise
  { key: "seats", category: "enterprise", values: ["1", "3", "5", "unlimited"] },
  { key: "storage", category: "enterprise", values: ["50 MB", "100 MB", "1 GB", "10 GB"] },
  { key: "dataRetention", category: "enterprise", values: ["90d", "180d", "1y", "2y"] },
  { key: "knowledgeArticles", category: "enterprise", values: ["5", "20", "unlimited", "unlimited"] },
  { key: "emailTemplates", category: "enterprise", values: ["2", "4", "20", "unlimited"] },
  { key: "sso", category: "enterprise", values: ["false", "false", "false", "true"] },
  { key: "auditLog", category: "enterprise", values: ["false", "false", "false", "true"] },
  { key: "customDomainKb", category: "enterprise", values: ["false", "false", "false", "true"] },
  { key: "prioritySupport", category: "enterprise", values: ["false", "false", "false", "true"] },
  { key: "whiteLabel", category: "enterprise", values: ["false", "false", "false", "custom"] },
];

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
