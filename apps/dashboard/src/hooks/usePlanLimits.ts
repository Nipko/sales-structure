"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";

export interface PlanFeatures {
  maxAgents: number;
  maxAiMessages: number;
  maxCalendars: number;
  maxContacts: number;
  maxProperties: number;
  seats: number;
  automationRules: number;
  broadcastCampaigns: number;
  appointmentsServices: number;
  knowledgeArticles: number;
  customAttributes: number;
  emailTemplates: number;
  maxPipelines: number;
  pipelineStages: number;
  segments: number;
  mediaStorageMb: number;
  externalCrm: number;
  outboundWebhooks: number;
  llmTier: string;
  customPrompt: boolean;
  customTemplates: boolean;
  aiInsights: boolean;
  recall: boolean;
  scheduledReports: boolean;
  sso: boolean;
  auditLog: boolean;
  biApi: boolean;
  customDomainKb: boolean;
  whiteLabel: boolean;
  prioritySupport: boolean;
  staffScheduling: boolean;
  vehicleInventory: boolean;
  ecommerce: boolean;
  channelManager: boolean;
  widget: boolean;
  dataRetentionDays: number;
  channels: string[];
  [key: string]: any;
}

const STARTER_DEFAULTS: PlanFeatures = {
  maxAgents: 1, maxAiMessages: 5000, maxCalendars: 1, maxContacts: 500,
  maxProperties: 2, seats: 3, automationRules: 5, broadcastCampaigns: 3,
  appointmentsServices: 2, knowledgeArticles: 20, customAttributes: 5,
  emailTemplates: 4, maxPipelines: 1, pipelineStages: 5, segments: 3, mediaStorageMb: 100,
  externalCrm: 0, outboundWebhooks: 0, llmTier: "tier_3",
  customPrompt: false, customTemplates: false, aiInsights: false,
  recall: false, scheduledReports: false, sso: false, auditLog: false,
  biApi: false, customDomainKb: false, whiteLabel: false,
  prioritySupport: false, staffScheduling: false, vehicleInventory: false,
  ecommerce: false, channelManager: false, widget: false, dataRetentionDays: 180,
  channels: ["whatsapp", "instagram", "messenger", "telegram"],
};

export function usePlanLimits() {
  const { activeTenantId } = useTenant();
  const [features, setFeatures] = useState<PlanFeatures>(STARTER_DEFAULTS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const res = await api.getPlanFeatures(activeTenantId);
      if (res?.success && res.data) {
        setFeatures({ ...STARTER_DEFAULTS, ...res.data });
      }
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { reload(); }, [reload]);

  const isUnlimited = (val: number) => val === -1 || val >= 999;

  const canCreate = (limitKey: keyof PlanFeatures, currentCount: number): boolean => {
    const limit = features[limitKey];
    if (typeof limit !== "number") return true;
    if (isUnlimited(limit)) return true;
    return currentCount < limit;
  };

  const getLimit = (limitKey: keyof PlanFeatures): number | null => {
    const limit = features[limitKey];
    if (typeof limit !== "number") return null;
    if (isUnlimited(limit)) return null;
    return limit;
  };

  return { features, loading, reload, canCreate, getLimit, isUnlimited };
}
