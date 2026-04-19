export interface PersonaConfig {
  persona: {
    name: string;
    role: string;
    personality: { tone: string; formality: string; emojiUsage: string; humor: string };
    greeting: string;
    fallbackMessage: string;
  };
  behavior: {
    rules: string[];
    forbiddenTopics: string[];
    handoffTriggers: string[];
    requiredFields: Record<string, any>;
  };
  hours: {
    timezone: string;
    schedule: Record<string, { start: string; end: string } | null>;
    afterHoursMessage: string;
  };
  llm: {
    temperature: number;
    maxTokens: number;
    routing: any;
    memory: { shortTerm: number; longTerm: boolean; summaryAfter: number };
  };
  rag: {
    enabled: boolean;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    similarityThreshold: number;
  };
  tools?: {
    appointments?: {
      enabled: boolean;
      canBook: boolean;
      canCancel: boolean;
    };
  };
  industry: string;
  language: string;
  name: string;
  slug: string;
  id: string;
  isActive: boolean;
}

export const defaultConfig: PersonaConfig = {
  persona: {
    name: "",
    role: "",
    personality: { tone: "friendly", formality: "casual-professional", emojiUsage: "minimal", humor: "" },
    greeting: "",
    fallbackMessage: "",
  },
  behavior: {
    rules: [],
    forbiddenTopics: [],
    handoffTriggers: [],
    requiredFields: {},
  },
  hours: {
    timezone: "America/Bogota",
    schedule: {
      lun: { start: "08:00", end: "18:00" },
      mar: { start: "08:00", end: "18:00" },
      mie: { start: "08:00", end: "18:00" },
      jue: { start: "08:00", end: "18:00" },
      vie: { start: "08:00", end: "18:00" },
      sab: { start: "08:00", end: "14:00" },
      dom: null,
    },
    afterHoursMessage: "",
  },
  llm: {
    temperature: 0.7,
    maxTokens: 800,
    routing: {
      tiers: {
        tier_1_premium: { models: ["gpt-4o"], costLevel: "high" },
        tier_2_standard: { models: ["gpt-4o-mini"], costLevel: "medium" },
        tier_3_efficient: { models: ["gpt-4o-mini"], costLevel: "low" },
        tier_4_budget: { models: ["gpt-4o-mini"], costLevel: "very_low" },
      },
      factors: {},
      fallback: "auto_upgrade",
    },
    memory: { shortTerm: 20, longTerm: false, summaryAfter: 30 },
  },
  rag: { enabled: false, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 },
  tools: { appointments: { enabled: false, canBook: true, canCancel: true } },
  industry: "general",
  language: "es-CO",
  name: "",
  slug: "",
  id: "",
  isActive: true,
};

export const DAY_LABELS: Record<string, string> = {
  lun: "Monday",
  mar: "Tuesday",
  mie: "Wednesday",
  jue: "Thursday",
  vie: "Friday",
  sab: "Saturday",
  dom: "Sunday",
};

export const inputCls = "w-full px-3.5 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-foreground text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors";
export const selectCls = `${inputCls} appearance-none pr-8 bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2712%27%20height=%2712%27%20fill=%27%239898b0%27%20viewBox=%270%200%2024%2024%27%3E%3Cpath%20d=%27M7%2010l5%205%205-5z%27/%3E%3C/svg%3E')] bg-no-repeat bg-[right_12px_center]`;
export const labelCls = "block text-[13px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5";
