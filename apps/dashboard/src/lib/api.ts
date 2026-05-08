/**
 * Parallext API Client
 * 
 * Centralized HTTP client for all dashboard → API communication.
 * Handles JWT auth headers, token refresh, and error handling.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

// ============================================
// Core fetch with auth
// ============================================

async function authFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> || {}),
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    // If 401, try token refresh
    if (res.status === 401 && token) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
            headers["Authorization"] = `Bearer ${refreshed}`;
            return fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
        }
        // Refresh failed → logout
        if (typeof window !== "undefined") {
            localStorage.clear();
            window.location.href = "/login";
        }
    }

    return res;
}

async function refreshAccessToken(): Promise<string | null> {
    const refreshToken = typeof window !== "undefined" ? localStorage.getItem("refreshToken") : null;
    if (!refreshToken) return null;

    try {
        const res = await fetch(`${BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        if (data.success && data.data.accessToken) {
            localStorage.setItem("accessToken", data.data.accessToken);
            // Refresh token rotation: store new refresh token if provided
            if (data.data.refreshToken) {
                localStorage.setItem("refreshToken", data.data.refreshToken);
            }
            return data.data.accessToken;
        }
        return null;
    } catch {
        return null;
    }
}

// ============================================
// Public API methods
// ============================================

export const api = {
    // --- Auth ---
    login: (email: string, password: string) =>
        apiPost("/auth/login", { email, password }),

    googleLogin: (idToken: string) =>
        apiPost("/auth/google", { idToken }),
    forgotPassword: (email: string) =>
        apiPost("/auth/forgot-password", { email }),
    resetPassword: (email: string, code: string, newPassword: string) =>
        apiPost("/auth/reset-password", { email, code, newPassword }),
    changePassword: (currentPassword: string, newPassword: string) =>
        apiPost("/auth/change-password", { currentPassword, newPassword }),
    send2FA: () => apiPost("/auth/send-2fa", {}),
    verify2FA: (code: string) => apiPost("/auth/verify-2fa", { code }),

    setupPassword: (password: string) =>
        apiPost("/auth/setup-password", { password }),

    sendVerification: () =>
        apiPost("/auth/send-verification", {}),

    verifyEmail: (code: string) =>
        apiPost("/auth/verify-email", { code }),

    completeOnboarding: (data: any) =>
        apiPost("/auth/complete-onboarding", data),

    me: () => apiPost("/auth/me", {}),

    updateProfile: (data: { firstName?: string; lastName?: string; phone?: string; jobTitle?: string }) =>
        apiPost("/auth/update-profile", data),

    // --- Tenant Timezone ---
    getTenantTimezone: () => apiGet("/auth/tenant/timezone"),
    updateTenantTimezone: (timezone: string) => apiPost("/auth/tenant/timezone", { timezone }),

    // --- Setup Wizard ---
    getPersonaTemplates: (tenantId?: string) =>
        apiGet(`/persona/templates${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`),

    applySetupTemplate: (tenantId: string, data: { templateId: string; customizations?: any; selectedChannels?: string[] }) =>
        apiPost(`/persona/${tenantId}/setup-wizard`, data),
    skipSetupWizard: (tenantId: string) =>
        apiPost(`/persona/${tenantId}/setup-wizard/skip`, {}),

    getSetupStatus: (tenantId: string) =>
        apiGet(`/persona/${tenantId}/setup-status`),

    // --- Tenants ---
    getTenants: () => apiGet("/tenants"),
    getTenant: (id: string) => apiGet(`/tenants/${id}`),
    getTenantUsers: (tenantId: string) => apiGet(`/tenants/${tenantId}/users`),
    adminResetPassword: (userId: string, newPassword: string) =>
        apiPost("/auth/admin/reset-password", { userId, newPassword }),

    // --- Agent Console ---
    getInbox: (tenantId: string, filter?: string) =>
        apiGet(`/agent-console/inbox/${tenantId}${filter ? `?filter=${filter}` : ""}`),
    reopenConversation: (tenantId: string, conversationId: string) =>
        apiPost(`/agent-console/conversation/${tenantId}/${conversationId}/reopen`, {}),

    getConversation: (tenantId: string, id: string) =>
        apiGet(`/agent-console/conversation/${tenantId}/${id}`),

    sendMessage: (tenantId: string, id: string, content: string, agentId?: string) =>
        apiPost(`/agent-console/conversation/${tenantId}/${id}/message`, { content, agentId }),

    assignConversation: (tenantId: string, id: string, agentId: string) =>
        apiPut(`/agent-console/conversation/${tenantId}/${id}/assign`, { agentId }),

    resolveConversation: (tenantId: string, id: string, agentId?: string) =>
        apiPut(`/agent-console/conversation/${tenantId}/${id}/resolve`, { agentId }),

    addNote: (tenantId: string, id: string, content: string, agentId?: string) =>
        apiPost(`/agent-console/conversation/${tenantId}/${id}/note`, { content, agentId }),

    getStats: (tenantId: string, agentId: string) =>
        apiGet(`/agent-console/stats/${tenantId}/${agentId}`),

    getCannedResponses: (tenantId: string) =>
        apiGet(`/agent-console/canned/${tenantId}`),

    getAISuggestion: (tenantId: string, id: string) =>
        apiGet(`/agent-console/conversation/${tenantId}/${id}/suggest`),

    // --- Pipeline ---
    getKanban: (tenantId: string) =>
        apiGet(`/pipeline/kanban/${tenantId}`),

    getStages: (tenantId: string) =>
        apiGet(`/pipeline/stages/${tenantId}`),

    createDeal: (tenantId: string, data: any) =>
        apiPost(`/pipeline/deals/${tenantId}`, data),

    moveDeal: (tenantId: string, dealId: string, stageId: string) =>
        apiPut(`/pipeline/deals/${tenantId}/${dealId}/move`, { stageId }),

    updateDeal: (tenantId: string, dealId: string, data: any) =>
        apiPut(`/pipeline/deals/${tenantId}/${dealId}`, data),

    // --- Automation ---
    getAutomationRules: (tenantId: string) =>
        apiGet(`/automation/rules/${tenantId}`),

    createRule: (tenantId: string, data: any) =>
        apiPost(`/automation/rules/${tenantId}`, data),

    toggleRule: (tenantId: string, ruleId: string, isActive?: boolean) =>
        apiPut(`/automation/rules/${tenantId}/${ruleId}/toggle`, { isActive }),

    deleteRule: (tenantId: string, ruleId: string) =>
        apiDelete(`/automation/rules/${tenantId}/${ruleId}`),

    updateRule: (tenantId: string, ruleId: string, data: any) =>
        apiPut(`/automation/rules/${tenantId}/${ruleId}`, data),

    getRuleExecutions: (tenantId: string, ruleId: string) =>
        apiGet(`/automation/rules/${tenantId}/${ruleId}/executions`),

    // --- Persona / Agent Config ---
    getPersonaConfig: (tenantId: string) =>
        apiGet(`/persona/${tenantId}/active`),

    getPersonaVersions: (tenantId: string) =>
        apiGet(`/persona/${tenantId}/versions`),

    savePersonaConfig: (tenantId: string, config: any) =>
        apiPut(`/persona/${tenantId}`, config),

    // --- Multi-Agent ---
    listAgents: (tenantId: string) => apiGet(`/persona/${tenantId}/agents`),
    getAgent: (tenantId: string, agentId: string) => apiGet(`/persona/${tenantId}/agents/${agentId}`),
    createAgent: (tenantId: string, data: any) => apiPost(`/persona/${tenantId}/agents`, data),
    updateAgent: (tenantId: string, agentId: string, data: any) => apiPut(`/persona/${tenantId}/agents/${agentId}`, data),
    deleteAgent: (tenantId: string, agentId: string) => apiDelete(`/persona/${tenantId}/agents/${agentId}`),
    duplicateAgent: (tenantId: string, agentId: string) => apiPost(`/persona/${tenantId}/agents/${agentId}/duplicate`, {}),
    saveAgentAsTemplate: (tenantId: string, agentId: string, name: string, description: string) => apiPost(`/persona/${tenantId}/agents/${agentId}/save-template`, { name, description }),
    listAgentTemplates: (tenantId: string, industry?: string) => apiGet(`/persona/${tenantId}/agent-templates${industry ? `?industry=${encodeURIComponent(industry)}` : ''}`),
    deleteAgentTemplate: (tenantId: string, templateId: string) => apiDelete(`/persona/${tenantId}/agent-templates/${templateId}`),
    getPlanFeatures: (tenantId: string) => apiGet(`/persona/${tenantId}/plan-features`),

    // --- Agent Availability ---
    updateAgentStatus: (userId: string, status: string) =>
        apiPut(`/agent-console/status/${userId}`, { status }),
    getAgentsWithStatus: (tenantId: string) =>
        apiGet(`/agent-console/agents/${tenantId}/status`),

    // --- Snooze ---
    snoozeConversation: (tenantId: string, convId: string, snoozeUntil: string) =>
        apiPut(`/agent-console/conversation/${tenantId}/${convId}/snooze`, { snoozeUntil }),
    unsnoozeConversation: (tenantId: string, convId: string) =>
        apiPut(`/agent-console/conversation/${tenantId}/${convId}/unsnooze`, {}),

    // --- Archive & Delete ---
    archiveConversation: (tenantId: string, conversationId: string, agentId?: string) =>
        apiPut(`/agent-console/conversation/${tenantId}/${conversationId}/archive`, { agentId }),
    deleteConversation: (tenantId: string, conversationId: string) =>
        apiDelete(`/agent-console/conversation/${tenantId}/${conversationId}`),
    deleteMessage: (tenantId: string, conversationId: string, messageId: string) =>
        apiDelete(`/agent-console/conversation/${tenantId}/${conversationId}/message/${messageId}`),
    bulkArchiveConversations: (tenantId: string, ids: string[]) =>
        apiPost(`/agent-console/conversations/${tenantId}/bulk-archive`, { conversationIds: ids }),
    bulkDeleteConversations: (tenantId: string, ids: string[]) =>
        apiPost(`/agent-console/conversations/${tenantId}/bulk-delete`, { conversationIds: ids }),

    // --- Macros ---
    getMacros: (tenantId: string) => apiGet(`/agent-console/macros/${tenantId}`),
    createMacro: (tenantId: string, data: any) => apiPost(`/agent-console/macros/${tenantId}`, data),
    updateMacro: (tenantId: string, macroId: string, data: any) =>
        apiPut(`/agent-console/macros/${tenantId}/${macroId}`, data),
    executeMacro: (tenantId: string, macroId: string, conversationId: string, agentId: string) =>
        apiPost(`/agent-console/macros/${tenantId}/${macroId}/execute`, { conversationId, agentId }),

    // --- Custom Attributes ---
    getCustomAttributes: (tenantId: string, entityType?: string) =>
        apiGet(`/crm/custom-attributes/${tenantId}${entityType ? `?entityType=${entityType}` : ''}`),
    createCustomAttribute: (tenantId: string, data: any) =>
        apiPost(`/crm/custom-attributes/${tenantId}`, data),
    updateCustomAttribute: (tenantId: string, id: string, data: any) =>
        apiPut(`/crm/custom-attributes/${tenantId}/${id}`, data),

    // --- Contact Segments ---
    getSegments: (tenantId: string) => apiGet(`/crm/segments/${tenantId}`),
    createSegment: (tenantId: string, data: any) => apiPost(`/crm/segments/${tenantId}`, data),
    updateSegment: (tenantId: string, segmentId: string, data: any) =>
        apiPut(`/crm/segments/${tenantId}/${segmentId}`, data),
    getSegmentContacts: (tenantId: string, segmentId: string, page?: number) =>
        apiGet(`/crm/segments/${tenantId}/${segmentId}/contacts?page=${page || 1}`),

    // --- Scoring Config ---
    getScoringConfig: (tenantId: string) => apiGet(`/crm/scoring-config/${tenantId}`),
    saveScoringConfig: (tenantId: string, data: any) => apiPost(`/crm/scoring-config/${tenantId}`, data),

    // --- Identity ---
    getMergeSuggestions: (tenantId: string) =>
        apiGet(`/identity/${tenantId}/suggestions`),

    approveMerge: (tenantId: string, suggestionId: string) =>
        apiPost(`/identity/${tenantId}/suggestions/${suggestionId}/approve`, {}),

    rejectMerge: (tenantId: string, suggestionId: string) =>
        apiPost(`/identity/${tenantId}/suggestions/${suggestionId}/reject`, {}),

    getCustomerProfile: (tenantId: string, profileId: string) =>
        apiGet(`/identity/${tenantId}/profiles/${profileId}`),

    getSLAViolations: (tenantId: string) =>
        apiGet(`/pipeline/automation/${tenantId}/sla-violations`),

    // --- Inventory ---
    getInventoryOverview(tenantId: string) {
        return apiGet<any>(`/inventory/overview/${tenantId}`);
    },
    getInventoryProducts(tenantId: string) {
        return apiGet<any[]>(`/inventory/products/${tenantId}`);
    },
    createInventoryProduct(tenantId: string, data: any) {
        return apiPost(`/inventory/products/${tenantId}`, data);
    },
    updateInventoryProduct(tenantId: string, productId: string, data: any) {
        return apiPut(`/inventory/products/${tenantId}/${productId}`, data);
    },
    adjustInventoryStock(tenantId: string, productId: string, data: { type: 'in' | 'out' | 'adjustment', quantity: number, reason: string }) {
        return apiPost(`/inventory/products/${tenantId}/${productId}/stock`, data);
    },
    createInventoryCategory(tenantId: string, data: { name: string, color: string }) {
        return apiPost(`/inventory/categories/${tenantId}`, data);
    },

    // --- Orders ---
    getOrdersOverview(tenantId: string) {
        return apiGet<any>(`/orders/overview/${tenantId}`);
    },
    getOrderContacts(tenantId: string) {
        return apiGet<any[]>(`/orders/contacts/${tenantId}`);
    },
    createOrder(tenantId: string, data: any) {
        return apiPost(`/orders/${tenantId}`, data);
    },
    updateOrderStatus(tenantId: string, orderId: string, status: string) {
        return apiPut(`/orders/${tenantId}/${orderId}/status`, { status });
    },

    // --- Broadcast ---
    getCampaigns(tenantId: string) {
        return apiGet<any[]>(`/broadcast/campaigns/${tenantId}`);
    },
    createCampaign(tenantId: string, data: { name: string; channel: string; template: string; targetAudience: string }) {
        return apiPost<{ id: string }>(`/broadcast/campaigns/${tenantId}`, data);
    },
    sendCampaign(tenantId: string, campaignId: string) {
        return apiPost(`/broadcast/campaigns/${tenantId}/${campaignId}/send`, {});
    },

    // --- Analytics ---
    /** Commercial overview — real data: leads, hot, ready-to-close, handoffs, LLM cost */
    getCommercialOverview: (tenantId: string) =>
        apiGet<{
            leadsToday: number;
            leadsHot: number;
            leadsReadyToClose: number;
            conversations: number;
            handoffs: number;
            llmCostToday: number;
            messagesProcessed: number;
        }>(`/analytics/commercial-overview/${tenantId}`),

    /** Dashboard overview — includes recentActivity, modelUsage, and agent stats */
    getOverviewStats: (tenantId: string) =>
        apiGet(`/analytics/overview/${tenantId}`),

    /** Dashboard executive metrics — conversations, handoffs, messages, LLM cost, hourly volume */
    getDashboardMetrics: (tenantId: string) =>
        apiGet(`/analytics/dashboard/${tenantId}`),

    getPipelineFunnel: (tenantId: string) =>
        apiGet(`/analytics/pipeline/${tenantId}`),

    getConversationMetrics: (tenantId: string, days = 30) =>
        apiGet(`/analytics/conversations/${tenantId}?days=${days}`),

    getAgentLeaderboard: (tenantId: string) =>
        apiGet(`/analytics/agents/${tenantId}`),

    getCSATResponses: (tenantId: string) =>
        apiGet(`/analytics/csat/${tenantId}`),

    getCSATDistribution: (tenantId: string) =>
        apiGet(`/analytics/csat/${tenantId}/distribution`),

    submitCSAT: (tenantId: string, data: any) =>
        apiPost(`/analytics/csat/${tenantId}`, data),

    // --- Settings ---
    getSettings: () => apiGet("/settings"),
    updateSettings: (updates: Record<string, string>) =>
        apiPut("/settings", updates),
    getApiKeys: () => apiGet("/settings/api-keys"),
    setApiKey: (provider: string, key: string) =>
        apiPost("/settings/api-keys", { provider, key }),
    deleteApiKey: (provider: string) =>
        apiDelete(`/settings/api-keys/${provider}`),
    
    // --- Channels ---
    getWhatsappConfig: () => apiGet("/channels/whatsapp/config"),
    messengerOAuthConnect: (userAccessToken: string) =>
        apiPost("/channels/messenger/oauth-connect", { userAccessToken }),
    instagramOAuthConnect: (code: string) =>
        apiPost("/channels/instagram/oauth-connect", { code }),

    // --- Users ---
    getUsers: () => apiGet("/auth/users"),

    registerUser: (data: { email: string; password: string; firstName: string; lastName: string; role?: string; tenantId?: string }) =>
        apiPost("/auth/register", data),

    updateUserSkills: (userId: string, skillTags: string[]) =>
        apiPut(`/auth/users/${userId}/skills`, { skillTags }),

    // --- Tenant CRUD ---
    createTenant: (data: { name: string; slug: string; industry: string; language?: string; plan?: string }) =>
        apiPost("/tenants", data),

    updateTenant: (id: string, data: any) =>
        apiPatch(`/tenants/${id}`, data),

    deactivateTenant: (id: string) =>
        apiPost(`/tenants/${id}/deactivate`, {}),

    getTenantEngagement: (tenantId: string) =>
        apiGet(`/tenants/${tenantId}/engagement`),

    // --- Platform Stats (super_admin) ---
    getPlatformStats: () => apiGet("/tenants/stats"),
    getPlatformBilling: () => apiGet("/tenants/platform-billing"),
    getPlatformUsage: () => apiGet("/tenants/platform-usage"),
    getPlatformHealth: () => apiGet("/tenants/health"),

    // --- Tenant management (super_admin) ---
    suspendTenant: (tenantId: string, reason: string) =>
        apiPost(`/offboarding/${tenantId}/suspend`, { reason }),
    reactivateTenant: (tenantId: string) =>
        apiPost(`/offboarding/${tenantId}/reactivate`, {}),
    extendTrial: (tenantId: string, days: number) =>
        apiPost(`/offboarding/${tenantId}/extend-trial`, { days }),
    impersonateTenant: (tenantId: string) =>
        apiPost(`/auth/impersonate/${tenantId}`, {}),
    purgeTenant: (tenantId: string) =>
        apiDelete(`/offboarding/${tenantId}/purge`),
    reactivateChannels: (tenantId: string) =>
        apiPost(`/offboarding/${tenantId}/reactivate-channels`, {}),
    getTenantQuotaOverrides: (tenantId: string) =>
        apiGet(`/tenants/${tenantId}/quota-overrides`),
    getTenantFeatureFlags: (tenantId: string) =>
        apiGet(`/tenants/${tenantId}/feature-flags`),
    setTenantFeatureFlags: (tenantId: string, flags: Record<string, boolean>) =>
        apiPut(`/tenants/${tenantId}/feature-flags`, { flags }),
    setTenantQuotaOverrides: (tenantId: string, data: {
        automation?: number; outbound?: number; broadcast?: number;
        maxAgents?: number; maxCalendars?: number;
        priority?: number; maxPendingJobs?: number;
        reason?: string;
    }) => apiPut(`/tenants/${tenantId}/quota-overrides`, data),
    getComplianceAdminOverview: () => apiGet("/compliance/admin/overview"),
    getOnboardingFunnel: (days = 30) => apiGet(`/tenants/onboarding-funnel?days=${days}`),
    getQueueJobs: (queueName: string, state: string, limit = 50) =>
        apiGet(`/tenants/queue-jobs/${queueName}/${state}?limit=${limit}`),
    getQueueJobDetail: (queueName: string, jobId: string) =>
        apiGet(`/tenants/queue-jobs/${queueName}/job/${jobId}`),
    removeQueueJob: (queueName: string, jobId: string) =>
        apiDelete(`/tenants/queue-jobs/${queueName}/job/${jobId}`),
    retryQueueJob: (queueName: string, jobId: string) =>
        apiPost(`/tenants/queue-jobs/${queueName}/job/${jobId}/retry`, {}),
    cleanQueue: (queueName: string, data: { state: string; olderThanMs?: number; limit?: number }) =>
        apiPost(`/tenants/queue-jobs/${queueName}/clean`, data),
    exportContactData: (tenantId: string, contactId: string) =>
        apiPost(`/compliance/admin/export-contact-data/${tenantId}/${contactId}`, {}),
    getWebhookTap: (params?: { channelType?: string; status?: string; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.channelType) qs.set("channelType", params.channelType);
        if (params?.status) qs.set("status", params.status);
        if (params?.limit) qs.set("limit", String(params.limit));
        const q = qs.toString();
        return apiGet(`/webhook-tap${q ? `?${q}` : ""}`);
    },
    getLlmStats: (params?: { days?: number; tenantId?: string }) => {
        const qs = new URLSearchParams();
        if (params?.days) qs.set("days", String(params.days));
        if (params?.tenantId) qs.set("tenantId", params.tenantId);
        const q = qs.toString();
        return apiGet(`/tenants/llm-stats${q ? `?${q}` : ""}`);
    },
    // Platform-wide maintenance banner (public read, super_admin write)
    getPlatformMaintenance: () => apiGet("/platform-status"),
    setPlatformMaintenance: (data: {
        enabled: boolean;
        message: string;
        severity: "info" | "warning" | "critical";
        expiresAt?: string | null;
    }) => apiPut("/platform-status", data),

    getAuditLogs: (filters?: { tenantId?: string; action?: string; since?: string; limit?: number; offset?: number }) => {
        const qs = new URLSearchParams();
        if (filters?.tenantId) qs.set("tenantId", filters.tenantId);
        if (filters?.action) qs.set("action", filters.action);
        if (filters?.since) qs.set("since", filters.since);
        if (filters?.limit) qs.set("limit", String(filters.limit));
        if (filters?.offset) qs.set("offset", String(filters.offset));
        const q = qs.toString();
        return apiGet(`/tenants/audit-logs${q ? `?${q}` : ""}`);
    },

    // --- Copilot ---
    copilotChat: (data: {
        message: string;
        context: {
            page: string;
            tenantId?: string;
            tenantName?: string;
            userName: string;
            userRole: string;
        };
        history: { role: string; content: string }[];
    }) =>
        apiPost<{ reply: string }>("/copilot/chat", data),

    // --- Media ---
    uploadMedia: async (tenantId: string, file: File, entityType?: string, entityId?: string) => {
        const formData = new FormData();
        formData.append("file", file);
        let url = `/media/upload/${tenantId}`;
        const params = new URLSearchParams();
        if (entityType) params.set("entityType", entityType);
        if (entityId) params.set("entityId", entityId);
        if (params.toString()) url += `?${params}`;
        const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        const res = await fetch(`${BASE_URL}${url}`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
        });
        return res.json();
    },
    uploadLogo: async (tenantId: string, file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        const res = await fetch(`${BASE_URL}/media/logo/${tenantId}`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
        });
        return res.json();
    },
    getMediaList: (tenantId: string, entityType?: string) =>
        apiGet(`/media/list/${tenantId}${entityType ? `?entityType=${entityType}` : ""}`),
    updateMedia: (tenantId: string, fileId: string, data: { label?: string; description?: string; tags?: string[] }) =>
        apiPut(`/media/update/${tenantId}/${fileId}`, data),
    getMediaTags: (tenantId: string) =>
        apiGet(`/media/tags/${tenantId}`),
    deleteMedia: (tenantId: string, fileId: string) =>
        apiDelete(`/media/delete/${tenantId}/${fileId}`),
    mediaHealth: () => apiGet('/media/health'),

    // --- Email Templates ---
    getEmailTemplates: (tenantId: string) =>
        apiGet(`/email-templates/${tenantId}`),
    getEmailTemplate: (tenantId: string, templateId: string) =>
        apiGet(`/email-templates/${tenantId}/${templateId}`),
    saveEmailTemplate: (tenantId: string, templateId: string, data: any) =>
        apiPut(`/email-templates/${tenantId}/${templateId}`, data),
    createEmailTemplate: (tenantId: string, data: any) =>
        apiPost(`/email-templates/${tenantId}`, data),
    deleteEmailTemplate: (tenantId: string, templateId: string) =>
        apiDelete(`/email-templates/${tenantId}/${templateId}`),
    testEmailTemplate: (tenantId: string, templateId: string, to: string) =>
        apiPost(`/email-templates/${tenantId}/${templateId}/test`, { to }),

    // --- Compliance / Opt-Outs ---
    getOptOuts: (tenantId: string, status?: string, page?: number) =>
        apiGet(`/compliance/opt-outs/${tenantId}${status ? `?status=${status}` : ''}${page ? `&page=${page}` : ''}`),
    getOptOutStats: (tenantId: string) =>
        apiGet(`/compliance/opt-outs/${tenantId}/stats`),
    confirmOptOut: (tenantId: string, recordId: string, notes?: string) =>
        apiPut(`/compliance/opt-outs/${tenantId}/${recordId}/confirm`, { notes }),
    rejectOptOut: (tenantId: string, recordId: string, notes?: string) =>
        apiPut(`/compliance/opt-outs/${tenantId}/${recordId}/reject`, { notes }),
    createManualOptOut: (tenantId: string, data: any) =>
        apiPost(`/compliance/opt-outs/${tenantId}`, data),
    getLegalTexts: (tenantId: string) =>
        apiGet(`/compliance/legal-texts/${tenantId}`),
    createLegalText: (tenantId: string, data: any) =>
        apiPost(`/compliance/legal-texts/${tenantId}`, data),
    getConsents: (tenantId: string, leadId?: string) =>
        apiGet(`/compliance/consents/${tenantId}${leadId ? `?leadId=${leadId}` : ''}`),
    getDeletionRequests: (tenantId: string) =>
        apiGet(`/compliance/deletion-requests/${tenantId}`),
    createDeletionRequest: (tenantId: string, data: any) =>
        apiPost(`/compliance/deletion-requests/${tenantId}`, data),
    processDeletionRequest: (tenantId: string, id: string) =>
        apiPut(`/compliance/deletion-requests/${tenantId}/${id}/process`, {}),

    // --- Bookable Services ---
    getServices: (tenantId: string) =>
        apiGet(`/appointments/${tenantId}/services`),
    createService: (tenantId: string, data: any) =>
        apiPost(`/appointments/${tenantId}/services`, data),
    updateService: (tenantId: string, serviceId: string, data: any) =>
        apiPut(`/appointments/${tenantId}/services/${serviceId}`, data),
    deleteService: (tenantId: string, serviceId: string) =>
        apiDelete(`/appointments/${tenantId}/services/${serviceId}`),

    // --- Service-Staff Assignment ---
    getServiceStaff: (tenantId: string, serviceId: string) =>
        apiGet(`/appointments/${tenantId}/services/${serviceId}/staff`),
    assignServiceStaff: (tenantId: string, serviceId: string, userId: string, isPrimary = false) =>
        apiPost(`/appointments/${tenantId}/services/${serviceId}/staff`, { userId, isPrimary }),
    removeServiceStaff: (tenantId: string, serviceId: string, userId: string) =>
        apiDelete(`/appointments/${tenantId}/services/${serviceId}/staff/${userId}`),

    // --- Recurring Appointments ---
    createRecurringAppointment: (tenantId: string, data: any) =>
        apiPost(`/appointments/${tenantId}/recurring`, data),
    getRecurringSeries: (tenantId: string, groupId: string) =>
        apiGet(`/appointments/${tenantId}/recurring/${groupId}`),
    cancelRecurringSeries: (tenantId: string, groupId: string, reason?: string) =>
        apiPut(`/appointments/${tenantId}/recurring/${groupId}/cancel`, { reason }),

    // --- Appointment Analytics ---
    getAppointmentAnalytics: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/appointments/${tenantId}?start=${start}&end=${end}`),

    // --- Calendar Integrations ---
    getCalendarIntegrations: (tenantId: string) =>
        apiGet(`/appointments/${tenantId}/calendar/integrations?all=true`),
    getCalendarEvents: (tenantId: string, startDate: string, endDate: string) =>
        apiGet(`/appointments/${tenantId}/calendar/events?startDate=${startDate}&endDate=${endDate}`),
    connectGoogleCalendar: (tenantId: string, assignmentType?: string, assignmentId?: string) => {
        const params = new URLSearchParams();
        if (assignmentType) params.set('assignmentType', assignmentType);
        if (assignmentId) params.set('assignmentId', assignmentId);
        const qs = params.toString();
        return apiGet(`/appointments/${tenantId}/calendar/google/connect${qs ? `?${qs}` : ''}`);
    },
    connectMicrosoftCalendar: (tenantId: string, assignmentType?: string, assignmentId?: string) => {
        const params = new URLSearchParams();
        if (assignmentType) params.set('assignmentType', assignmentType);
        if (assignmentId) params.set('assignmentId', assignmentId);
        const qs = params.toString();
        return apiGet(`/appointments/${tenantId}/calendar/microsoft/connect${qs ? `?${qs}` : ''}`);
    },
    disconnectCalendar: (tenantId: string, integrationId: string) =>
        apiDelete(`/appointments/${tenantId}/calendar/${integrationId}`),
    updateCalendarAssignment: (tenantId: string, integrationId: string, data: { label?: string; assignmentType?: string; assignmentId?: string }) =>
        apiPut(`/appointments/${tenantId}/calendar/${integrationId}/assignment`, data),
    getBookableSlots: (tenantId: string, date: string, serviceId: string, userId?: string) =>
        apiGet(`/appointments/${tenantId}/bookable-slots?date=${date}&serviceId=${serviceId}${userId ? `&userId=${userId}` : ''}`),

    // --- Appointments ---
    getAppointments: (tenantId: string, params?: string) =>
        apiGet(`/appointments/${tenantId}${params ? `?${params}` : ""}`),
    createAppointment: (tenantId: string, data: any) =>
        apiPost(`/appointments/${tenantId}`, data),
    updateAppointment: (tenantId: string, appointmentId: string, data: any) =>
        apiPut(`/appointments/${tenantId}/${appointmentId}`, data),
    cancelAppointment: (tenantId: string, appointmentId: string, reason?: string) =>
        apiPut(`/appointments/${tenantId}/${appointmentId}/cancel`, { reason }),
    getAvailability: (tenantId: string, userId?: string) =>
        apiGet(`/appointments/${tenantId}/availability${userId ? `?userId=${userId}` : ""}`),
    saveAvailability: (tenantId: string, data: any) =>
        apiPost(`/appointments/${tenantId}/availability`, data),
    getBlockedDates: (tenantId: string) =>
        apiGet(`/appointments/${tenantId}/blocked-dates`),
    saveBlockedDate: (tenantId: string, data: any) =>
        apiPost(`/appointments/${tenantId}/blocked-dates`, data),
    deleteBlockedDate: (tenantId: string, dateId: string) =>
        apiDelete(`/appointments/${tenantId}/blocked-dates/${dateId}`),

    // --- Dashboard Analytics V2 ---
    getDashboardKPIs: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/overview-kpis/${tenantId}?start=${start}&end=${end}`),

    getDashboardVolume: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/conversations-volume/${tenantId}?start=${start}&end=${end}`),

    getDashboardResponseTimes: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/response-times/${tenantId}?start=${start}&end=${end}`),

    getDashboardAIMetrics: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/ai-metrics/${tenantId}?start=${start}&end=${end}`),

    getDashboardHeatmap: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/heatmap/${tenantId}?start=${start}&end=${end}`),

    exportDashboardCSV: (tenantId: string, start: string, end: string) =>
        apiGetBlob(`/dashboard-analytics/export/${tenantId}?start=${start}&end=${end}`),

    getDashboardRealtime: (tenantId: string) =>
        apiGet(`/dashboard-analytics/realtime/${tenantId}`),

    getDashboardAutomation: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/automation/${tenantId}?start=${start}&end=${end}`),

    getDashboardBroadcast: (tenantId: string, start: string, end: string) =>
        apiGet(`/dashboard-analytics/broadcast/${tenantId}?start=${start}&end=${end}`),

    // --- Alerts & Reports Config ---
    getAlertRules: (tenantId: string) =>
        apiGet(`/analytics-config/alerts/${tenantId}`),

    createAlertRule: (tenantId: string, data: any) =>
        apiPost(`/analytics-config/alerts/${tenantId}`, data),

    updateAlertRule: (tenantId: string, ruleId: string, data: any) =>
        apiPut(`/analytics-config/alerts/${tenantId}/${ruleId}`, data),

    deleteAlertRule: (tenantId: string, ruleId: string) =>
        apiDelete(`/analytics-config/alerts/${tenantId}/${ruleId}`),

    getReportConfig: (tenantId: string) =>
        apiGet(`/analytics-config/reports/${tenantId}`),

    upsertReportConfig: (tenantId: string, data: any) =>
        apiPost(`/analytics-config/reports/${tenantId}`, data),

    // --- Recall (time-since-last-appointment campaign) ---
    getRecallConfig: (tenantId: string) =>
        apiGet(`/recall/${tenantId}/config`),
    updateRecallConfig: (tenantId: string, data: {
        enabled: boolean; daysThreshold: number; cooldownDays: number;
        channelType: string; message: string;
    }) => apiPut(`/recall/${tenantId}/config`, data),
    runRecallNow: (tenantId: string) =>
        apiPost(`/recall/${tenantId}/run-now`, {}),

    // --- Phase 3: Anomalies, Cohorts ---
    getDashboardAnomalies: (tenantId: string) =>
        apiGet(`/dashboard-analytics/anomalies/${tenantId}`),

    getDashboardCohorts: (tenantId: string, months?: number) =>
        apiGet(`/dashboard-analytics/cohorts/${tenantId}?months=${months || 6}`),

    // --- Billing (Sprint 2+3) ---
    getBillingPlans: (country?: string) => apiGet(`/billing/plans${country ? `?country=${encodeURIComponent(country)}` : ""}`),
    getBillingSubscription: (tenantId: string) =>
        apiGet(`/billing/${tenantId}/subscription`),
    startBillingTrial: (tenantId: string, data: { planSlug: string; cardTokenId?: string; billingEmail?: string; billingCountry?: string }) =>
        apiPost(`/billing/${tenantId}/subscription`, data),
    upgradeBillingPlan: (tenantId: string, data: { planSlug: string; cardTokenId?: string }) =>
        apiPost(`/billing/${tenantId}/subscription/upgrade`, data),
    cancelBillingSubscription: (tenantId: string, data: { immediate?: boolean; reason?: string }) =>
        apiPost(`/billing/${tenantId}/subscription/cancel`, data),
    updateBillingPaymentMethod: (tenantId: string, data: { cardTokenId: string }) =>
        apiPost(`/billing/${tenantId}/subscription/payment-method`, data),
    pauseBillingSubscription: (tenantId: string, data?: { reason?: string }) =>
        apiPost(`/billing/${tenantId}/subscription/pause`, data || {}),
    resumeBillingSubscription: (tenantId: string) =>
        apiPost(`/billing/${tenantId}/subscription/resume`, {}),
    syncBillingSubscription: (tenantId: string) =>
        apiPost(`/billing/${tenantId}/subscription/sync`, {}),
    getBillingUsage: (tenantId: string) => apiGet(`/billing/${tenantId}/usage`),
    cancelPendingDowngrade: (tenantId: string) =>
        apiPost(`/billing/${tenantId}/subscription/cancel-pending-downgrade`, {}),

    // --- Billing admin (super_admin only) ---
    refundBillingPayment: (paymentId: string, data?: { amountCents?: number; reason?: string }) =>
        apiPost(`/billing-admin/payments/${paymentId}/refund`, data || {}),
    grantCompPlan: (tenantId: string, data: { planSlug: string; durationDays: number; reason: string }) =>
        apiPost(`/billing-admin/tenants/${tenantId}/comp-plan`, data),

    // --- Coupons (super_admin CRUD + tenant redeem) ---
    listCoupons: (active?: boolean) =>
        apiGet(`/billing-coupons/admin${active !== undefined ? `?active=${active}` : ""}`),
    createCoupon: (data: any) => apiPost(`/billing-coupons/admin`, data),
    updateCoupon: (id: string, data: any) => apiPut(`/billing-coupons/admin/${id}`, data),
    deactivateCoupon: (id: string) => apiDelete(`/billing-coupons/admin/${id}`),
    listCouponRedemptions: (id: string) => apiGet(`/billing-coupons/admin/${id}/redemptions`),
    validateCoupon: (tenantId: string, data: { code: string; planId: string }) =>
        apiPost(`/billing-coupons/validate/${tenantId}`, data),
    redeemCoupon: (tenantId: string, code: string) =>
        apiPost(`/billing-coupons/redeem/${tenantId}`, { code }),

    // --- Feature Requests (Apr 27) ---
    listFeatureRequests: (params?: { status?: string; category?: string; search?: string; sort?: string }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.category) qs.set("category", params.category);
        if (params?.search) qs.set("search", params.search);
        if (params?.sort) qs.set("sort", params.sort);
        const q = qs.toString();
        return apiGet<any[]>(`/feature-requests${q ? `?${q}` : ""}`);
    },
    getFeatureRequest: (id: string) => apiGet<any>(`/feature-requests/${id}`),
    findSimilarFeatureRequests: (text: string) =>
        apiGet<any[]>(`/feature-requests/similar?text=${encodeURIComponent(text)}`),
    createFeatureRequest: (data: { title: string; description: string; category?: string }) =>
        apiPost<any>(`/feature-requests`, data),
    voteFeatureRequest: (id: string) => apiPost(`/feature-requests/${id}/vote`, {}),
    unvoteFeatureRequest: (id: string) =>
        authFetch(`/feature-requests/${id}/vote`, { method: "DELETE" }).then((r) => r.json()),
    getFeatureRequestChangelog: () => apiGet<any[]>(`/feature-requests/changelog`),

    // --- External CRM integrations (Apr 28) ---
    listCrmProviders: () => apiGet<{ providers: string[] }>(`/external-crm/providers`),
    listCrmConnections: (tenantId: string) =>
        apiGet<any[]>(`/external-crm/${tenantId}/connections`),
    startCrmConnect: (tenantId: string, provider: string) =>
        apiPost<{ authorizeUrl: string }>(`/external-crm/${tenantId}/connect/${provider}`, {}),
    testCrmConnection: (tenantId: string, connectionId: string) =>
        apiPost<{ ok: boolean; details?: string }>(`/external-crm/${tenantId}/connections/${connectionId}/test`, {}),
    disconnectCrm: (tenantId: string, connectionId: string) =>
        authFetch(`/external-crm/${tenantId}/connections/${connectionId}`, { method: "DELETE" }).then((r) => r.json()),
    previewCrmImport: (tenantId: string, connectionId: string) =>
        apiGet<any>(`/external-crm/${tenantId}/connections/${connectionId}/import/preview`),
    startCrmImport: (tenantId: string, connectionId: string) =>
        apiPost<{ importId: string; status: string }>(`/external-crm/${tenantId}/connections/${connectionId}/import/start`, {}),
    getCrmImport: (tenantId: string, importId: string) =>
        apiGet<any>(`/external-crm/${tenantId}/imports/${importId}`),
    listCrmImports: (tenantId: string, connectionId: string) =>
        apiGet<any[]>(`/external-crm/${tenantId}/connections/${connectionId}/imports`),
    listFeatureRequestComments: (id: string) =>
        apiGet<any[]>(`/feature-requests/${id}/comments`),
    commentFeatureRequest: (id: string, body: string) =>
        apiPost(`/feature-requests/${id}/comments`, { body }),
    updateFeatureRequestStatus: (id: string, data: { status: string; declinedReason?: string }) =>
        apiPatch(`/feature-requests/${id}/status`, data),
    mergeFeatureRequest: (sourceId: string, targetId: string) =>
        apiPost(`/feature-requests/${sourceId}/merge`, { targetId }),

    fetch: async (endpoint: string, options: RequestInit = {}) => {
        const res = await authFetch(endpoint, options);
        if (!res.ok) {
            let errorMsg = `HTTP error! status: ${res.status}`;
            try {
                const json = await res.json();
                errorMsg = json.message || errorMsg;
            } catch (e) {}
            throw new Error(errorMsg);
        }
        return res.json();
    },

    // ─── Business Info (company identity the agent references) ───
    getBusinessInfo: (tenantId: string) =>
        apiGet<any>(`/business-info/${tenantId}`),
    updateBusinessInfo: (tenantId: string, data: any) =>
        apiPut<any>(`/business-info/${tenantId}`, data),

    // ─── FAQs (first-class Q&A) ───
    listFaqs: (tenantId: string, opts?: { publishedOnly?: boolean; category?: string }) => {
        const q = new URLSearchParams();
        if (opts?.publishedOnly !== undefined) q.set("publishedOnly", String(opts.publishedOnly));
        if (opts?.category) q.set("category", opts.category);
        const qs = q.toString();
        return apiGet<any[]>(`/faqs/${tenantId}${qs ? `?${qs}` : ""}`);
    },
    createFaq: (tenantId: string, data: any) =>
        apiPost<any>(`/faqs/${tenantId}`, data),
    updateFaq: (tenantId: string, id: string, data: any) =>
        apiPut<any>(`/faqs/${tenantId}/${id}`, data),
    deleteFaq: (tenantId: string, id: string) =>
        apiDelete(`/faqs/${tenantId}/${id}`),

    // ─── Policies (versioned legal/operational) ───
    listPolicies: (tenantId: string) =>
        apiGet<any[]>(`/policies/${tenantId}`),
    getPolicy: (tenantId: string, type: string) =>
        apiGet<any>(`/policies/${tenantId}/${type}`),
    listPolicyVersions: (tenantId: string, type: string) =>
        apiGet<any[]>(`/policies/${tenantId}/${type}/versions`),
    upsertPolicy: (tenantId: string, data: { type: string; title: string; content: string }) =>
        apiPost<any>(`/policies/${tenantId}`, data),
    deletePolicy: (tenantId: string, id: string) =>
        apiDelete(`/policies/${tenantId}/${id}`),

    // ─── Test Agent (dry-run with debug info) ───
    testAgent: (tenantId: string, agentId: string, data: { message: string; conversationHistory?: Array<{ role: string; content: string }>; channelType?: string }) =>
        apiPost<any>(`/agent-test/${tenantId}/${agentId}`, data),

    // ─── Offers / Promotions ───
    listOffers: (tenantId: string, activeOnly = false) => {
        const qs = activeOnly ? "?activeOnly=true" : "";
        return apiGet<any[]>(`/offers/${tenantId}${qs}`);
    },
    createOffer: (tenantId: string, data: any) =>
        apiPost<any>(`/offers/${tenantId}`, data),
    updateOffer: (tenantId: string, id: string, data: any) =>
        apiPut<any>(`/offers/${tenantId}/${id}`, data),
    deleteOffer: (tenantId: string, id: string) =>
        apiDelete(`/offers/${tenantId}/${id}`),

    // ─── Offboarding ───
    cancelAccount: (tenantId: string, reason?: string) =>
        apiPost(`/offboarding/${tenantId}/cancel`, { reason }),
    getOffboardingStatus: (tenantId: string) =>
        apiGet<{ subscriptionStatus: string; currentPeriodEnd: string | null }>(`/offboarding/${tenantId}/status`),

    // ─── Vacation Rental ───
    listProperties: (tenantId: string) => apiGet(`/vacation-rental/${tenantId}/properties`),
    createProperty: (tenantId: string, data: any) => apiPost(`/vacation-rental/${tenantId}/properties`, data),
    getProperty: (tenantId: string, propertyId: string) => apiGet(`/vacation-rental/${tenantId}/properties/${propertyId}`),
    updateProperty: (tenantId: string, propertyId: string, data: any) => apiPut(`/vacation-rental/${tenantId}/properties/${propertyId}`, data),
    deleteProperty: (tenantId: string, propertyId: string) => apiDelete(`/vacation-rental/${tenantId}/properties/${propertyId}`),
    getPropertyAvailability: (tenantId: string, propertyId: string, checkIn: string, checkOut: string) => apiGet(`/vacation-rental/${tenantId}/properties/${propertyId}/availability?checkIn=${checkIn}&checkOut=${checkOut}`),
    getPropertyCalendar: (tenantId: string, propertyId: string, month: string) => apiGet(`/vacation-rental/${tenantId}/properties/${propertyId}/calendar?month=${month}`),
    listPropertyBookings: (tenantId: string, propertyId: string) => apiGet(`/vacation-rental/${tenantId}/properties/${propertyId}/bookings`),
    createPropertyBooking: (tenantId: string, propertyId: string, data: any) => apiPost(`/vacation-rental/${tenantId}/properties/${propertyId}/bookings`, data),
    listPropertyFeeds: (tenantId: string, propertyId: string) => apiGet(`/vacation-rental/${tenantId}/properties/${propertyId}/feeds`),
    addPropertyFeed: (tenantId: string, propertyId: string, data: any) => apiPost(`/vacation-rental/${tenantId}/properties/${propertyId}/feeds`, data),
    updatePropertyFeed: (tenantId: string, feedId: string, data: any) => apiPut(`/vacation-rental/${tenantId}/feeds/${feedId}`, data),
    deletePropertyFeed: (tenantId: string, feedId: string) => apiDelete(`/vacation-rental/${tenantId}/feeds/${feedId}`),
    syncPropertyFeed: (tenantId: string, feedId: string) => apiPost(`/vacation-rental/${tenantId}/feeds/${feedId}/sync`, {}),
    createPropertyBlock: (tenantId: string, propertyId: string, data: { checkIn: string, checkOut: string, summary?: string }) => apiPost(`/vacation-rental/${tenantId}/properties/${propertyId}/blocks`, data),
    deletePropertyBlock: (tenantId: string, blockId: string) => apiDelete(`/vacation-rental/${tenantId}/blocks/${blockId}`),

    // ─── Tours / Travel Packages (turismo: tours + agencia_viajes) ───
    listTourPackages: (tenantId: string, includeInactive = false) =>
        apiGet(`/tours/${tenantId}/packages${includeInactive ? '?includeInactive=true' : ''}`),
    createTourPackage: (tenantId: string, data: any) =>
        apiPost(`/tours/${tenantId}/packages`, data),
    getTourPackage: (tenantId: string, packageId: string) =>
        apiGet(`/tours/${tenantId}/packages/${packageId}`),
    updateTourPackage: (tenantId: string, packageId: string, data: any) =>
        apiPut(`/tours/${tenantId}/packages/${packageId}`, data),
    deleteTourPackage: (tenantId: string, packageId: string) =>
        apiDelete(`/tours/${tenantId}/packages/${packageId}`),
    listTourInventory: (tenantId: string, packageId: string, fromDate?: string) =>
        apiGet(`/tours/${tenantId}/packages/${packageId}/inventory${fromDate ? `?fromDate=${fromDate}` : ''}`),
    createTourInventory: (tenantId: string, packageId: string, data: { departureDate: string; departureTime?: string; totalSeats: number; priceOverride?: number; notes?: string }) =>
        apiPost(`/tours/${tenantId}/packages/${packageId}/inventory`, data),
    deleteTourInventory: (tenantId: string, inventoryId: string) =>
        apiDelete(`/tours/${tenantId}/inventory/${inventoryId}`),
    checkTourAvailability: (tenantId: string, packageId: string, date: string, partySize: number) =>
        apiGet(`/tours/${tenantId}/packages/${packageId}/availability?date=${date}&partySize=${partySize}`),
    listTourBookings: (tenantId: string, packageId?: string) =>
        apiGet(`/tours/${tenantId}/bookings${packageId ? `?packageId=${packageId}` : ''}`),
    createTourBooking: (tenantId: string, data: any) =>
        apiPost(`/tours/${tenantId}/bookings`, data),
    cancelTourBooking: (tenantId: string, bookingId: string) =>
        apiPut(`/tours/${tenantId}/bookings/${bookingId}/cancel`, {}),

    // ─── Treatment Plans (salud / dental, fisioterapia, estética) ───
    listAllTreatmentPlans: (tenantId: string, params?: { status?: string; search?: string }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.search) qs.set("search", params.search);
        const q = qs.toString();
        return apiGet(`/treatment-plans/${tenantId}/all${q ? `?${q}` : ""}`);
    },
    listTreatmentPlans: (tenantId: string, contactId: string) =>
        apiGet(`/treatment-plans/${tenantId}/contacts/${contactId}`),
    getTreatmentPlan: (tenantId: string, planId: string) =>
        apiGet(`/treatment-plans/${tenantId}/plans/${planId}`),
    createTreatmentPlan: (tenantId: string, data: { contactId: string; name: string; planType?: string; totalSessions: number; frequencyDays?: number; totalCost?: number; currency?: string; startedAt?: string; notes?: string }) =>
        apiPost(`/treatment-plans/${tenantId}/plans`, data),
    updateTreatmentPlan: (tenantId: string, planId: string, data: any) =>
        apiPut(`/treatment-plans/${tenantId}/plans/${planId}`, data),
    cancelTreatmentPlan: (tenantId: string, planId: string) =>
        apiDelete(`/treatment-plans/${tenantId}/plans/${planId}`),
    addTreatmentSession: (tenantId: string, planId: string, data: { scheduledAt?: string; appointmentId?: string; notes?: string }) =>
        apiPost(`/treatment-plans/${tenantId}/plans/${planId}/sessions`, data),
    completeTreatmentSession: (tenantId: string, sessionId: string) =>
        apiPut(`/treatment-plans/${tenantId}/sessions/${sessionId}/complete`, {}),
    cancelTreatmentSession: (tenantId: string, sessionId: string) =>
        apiPut(`/treatment-plans/${tenantId}/sessions/${sessionId}/cancel`, {}),

    // ─── Pets (veterinaria) ───
    // ─── Photography ───
    listPhotoSessions: (tenantId: string, params?: { status?: string; sessionType?: string; search?: string }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.sessionType) qs.set("sessionType", params.sessionType);
        if (params?.search) qs.set("search", params.search);
        const q = qs.toString();
        return apiGet(`/photography/${tenantId}/sessions${q ? `?${q}` : ""}`);
    },
    getPhotoSession: (tenantId: string, sessionId: string) =>
        apiGet(`/photography/${tenantId}/sessions/${sessionId}`),
    createPhotoSession: (tenantId: string, data: any) =>
        apiPost(`/photography/${tenantId}/sessions`, data),
    updatePhotoSession: (tenantId: string, sessionId: string, data: any) =>
        apiPut(`/photography/${tenantId}/sessions/${sessionId}`, data),
    deliverPhotoSession: (tenantId: string, sessionId: string, data: { galleryUrl: string; galleryPassword?: string }) =>
        apiPut(`/photography/${tenantId}/sessions/${sessionId}/deliver`, data),

    listAllPets: (tenantId: string, params?: { species?: string; search?: string }) => {
        const qs = new URLSearchParams();
        if (params?.species) qs.set("species", params.species);
        if (params?.search) qs.set("search", params.search);
        const q = qs.toString();
        return apiGet(`/pets/${tenantId}/all${q ? `?${q}` : ""}`);
    },
    listPetsForContact: (tenantId: string, contactId: string) =>
        apiGet(`/pets/${tenantId}/contacts/${contactId}`),
    getPet: (tenantId: string, petId: string) =>
        apiGet(`/pets/${tenantId}/pets/${petId}`),
    createPet: (tenantId: string, data: {
        contactId: string; name: string; species?: string; breed?: string;
        sex?: string; isNeutered?: boolean; birthDate?: string; weightKg?: number;
        color?: string; microchipId?: string; allergies?: string;
        chronicConditions?: string; currentMedications?: string; photoUrl?: string;
    }) => apiPost(`/pets/${tenantId}/pets`, data),
    updatePet: (tenantId: string, petId: string, data: any) =>
        apiPut(`/pets/${tenantId}/pets/${petId}`, data),
    deletePet: (tenantId: string, petId: string) =>
        apiDelete(`/pets/${tenantId}/pets/${petId}`),
    addPetVaccination: (tenantId: string, petId: string, data: {
        vaccineName: string; appliedAt: string; nextDueAt?: string;
        lotNumber?: string; vetName?: string; notes?: string;
    }) => apiPost(`/pets/${tenantId}/pets/${petId}/vaccinations`, data),
    deletePetVaccination: (tenantId: string, vaccinationId: string) =>
        apiDelete(`/pets/${tenantId}/vaccinations/${vaccinationId}`),

    // ─── Restaurants ───
    listMenuCategories: (tenantId: string, includeInactive = false) =>
        apiGet(`/restaurants/${tenantId}/categories?includeInactive=${includeInactive}`),
    createMenuCategory: (tenantId: string, data: { name: string; description?: string; sortOrder?: number }) =>
        apiPost(`/restaurants/${tenantId}/categories`, data),
    updateMenuCategory: (tenantId: string, id: string, data: any) =>
        apiPut(`/restaurants/${tenantId}/categories/${id}`, data),
    deleteMenuCategory: (tenantId: string, id: string) =>
        apiDelete(`/restaurants/${tenantId}/categories/${id}`),
    listMenuItems: (tenantId: string, params?: { categoryId?: string; availableOnly?: boolean; includeInactive?: boolean }) => {
        const qs = new URLSearchParams();
        if (params?.categoryId) qs.set("categoryId", params.categoryId);
        if (params?.availableOnly) qs.set("availableOnly", "true");
        if (params?.includeInactive) qs.set("includeInactive", "true");
        const q = qs.toString();
        return apiGet(`/restaurants/${tenantId}/items${q ? `?${q}` : ""}`);
    },
    getMenuItem: (tenantId: string, id: string) =>
        apiGet(`/restaurants/${tenantId}/items/${id}`),
    createMenuItem: (tenantId: string, data: any) =>
        apiPost(`/restaurants/${tenantId}/items`, data),
    updateMenuItem: (tenantId: string, id: string, data: any) =>
        apiPut(`/restaurants/${tenantId}/items/${id}`, data),
    deleteMenuItem: (tenantId: string, id: string) =>
        apiDelete(`/restaurants/${tenantId}/items/${id}`),
    listFoodOrders: (tenantId: string, params?: { status?: string; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.limit) qs.set("limit", String(params.limit));
        const q = qs.toString();
        return apiGet(`/restaurants/${tenantId}/orders${q ? `?${q}` : ""}`);
    },
    getFoodOrder: (tenantId: string, id: string) =>
        apiGet(`/restaurants/${tenantId}/orders/${id}`),
    updateFoodOrderStatus: (tenantId: string, id: string, status: string) =>
        apiPut(`/restaurants/${tenantId}/orders/${id}/status`, { status }),
    listMenuPromotions: (tenantId: string, activeOnly = true) =>
        apiGet(`/restaurants/${tenantId}/promotions?activeOnly=${activeOnly}`),
    createMenuPromotion: (tenantId: string, data: any) =>
        apiPost(`/restaurants/${tenantId}/promotions`, data),
    deleteMenuPromotion: (tenantId: string, id: string) =>
        apiDelete(`/restaurants/${tenantId}/promotions/${id}`),

    // ─── Gyms ───
    listMembershipPlans: (tenantId: string, includeInactive = false) =>
        apiGet(`/gyms/${tenantId}/plans?includeInactive=${includeInactive}`),
    createMembershipPlan: (tenantId: string, data: any) =>
        apiPost(`/gyms/${tenantId}/plans`, data),
    updateMembershipPlan: (tenantId: string, id: string, data: any) =>
        apiPut(`/gyms/${tenantId}/plans/${id}`, data),
    deleteMembershipPlan: (tenantId: string, id: string) =>
        apiDelete(`/gyms/${tenantId}/plans/${id}`),
    listGymMembers: (tenantId: string, params?: { status?: string; search?: string; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.search) qs.set("search", params.search);
        if (params?.limit) qs.set("limit", String(params.limit));
        const q = qs.toString();
        return apiGet(`/gyms/${tenantId}/members${q ? `?${q}` : ""}`);
    },
    getGymMember: (tenantId: string, id: string) =>
        apiGet(`/gyms/${tenantId}/members/${id}`),
    createGymMember: (tenantId: string, data: any) =>
        apiPost(`/gyms/${tenantId}/members`, data),
    freezeGymMember: (tenantId: string, id: string, days: number) =>
        apiPost(`/gyms/${tenantId}/members/${id}/freeze`, { days }),
    unfreezeGymMember: (tenantId: string, id: string) =>
        apiPost(`/gyms/${tenantId}/members/${id}/unfreeze`, {}),
    checkInGymMember: (tenantId: string, id: string, classId?: string) =>
        apiPost(`/gyms/${tenantId}/members/${id}/check-in`, { classId }),
    listFitnessClasses: (tenantId: string, params?: { from?: string; to?: string; classType?: string }) => {
        const qs = new URLSearchParams();
        if (params?.from) qs.set("from", params.from);
        if (params?.to) qs.set("to", params.to);
        if (params?.classType) qs.set("classType", params.classType);
        const q = qs.toString();
        return apiGet(`/gyms/${tenantId}/classes${q ? `?${q}` : ""}`);
    },
    createFitnessClass: (tenantId: string, data: any) =>
        apiPost(`/gyms/${tenantId}/classes`, data),
    cancelFitnessClass: (tenantId: string, id: string, reason?: string) =>
        apiPost(`/gyms/${tenantId}/classes/${id}/cancel`, { reason }),
    bookFitnessClass: (tenantId: string, classId: string, memberId: string) =>
        apiPost(`/gyms/${tenantId}/classes/${classId}/book`, { memberId }),

    // ─── Education ───
    listCourses: (tenantId: string, params?: { subject?: string; level?: string; modality?: string }) => {
        const qs = new URLSearchParams();
        if (params?.subject) qs.set("subject", params.subject);
        if (params?.level) qs.set("level", params.level);
        if (params?.modality) qs.set("modality", params.modality);
        const q = qs.toString();
        return apiGet(`/education/${tenantId}/courses${q ? `?${q}` : ""}`);
    },
    createCourse: (tenantId: string, data: any) =>
        apiPost(`/education/${tenantId}/courses`, data),
    updateCourse: (tenantId: string, id: string, data: any) =>
        apiPut(`/education/${tenantId}/courses/${id}`, data),
    deleteCourse: (tenantId: string, id: string) =>
        apiDelete(`/education/${tenantId}/courses/${id}`),
    listCourseCohorts: (tenantId: string, params?: { courseId?: string; status?: string }) => {
        const qs = new URLSearchParams();
        if (params?.courseId) qs.set("courseId", params.courseId);
        if (params?.status) qs.set("status", params.status);
        const q = qs.toString();
        return apiGet(`/education/${tenantId}/cohorts${q ? `?${q}` : ""}`);
    },
    createCohort: (tenantId: string, data: any) =>
        apiPost(`/education/${tenantId}/cohorts`, data),
    cancelCohort: (tenantId: string, id: string) =>
        apiPost(`/education/${tenantId}/cohorts/${id}/cancel`, {}),
    listEnrollments: (tenantId: string, params?: { cohortId?: string; contactId?: string; status?: string }) => {
        const qs = new URLSearchParams();
        if (params?.cohortId) qs.set("cohortId", params.cohortId);
        if (params?.contactId) qs.set("contactId", params.contactId);
        if (params?.status) qs.set("status", params.status);
        const q = qs.toString();
        return apiGet(`/education/${tenantId}/enrollments${q ? `?${q}` : ""}`);
    },
    createEnrollment: (tenantId: string, data: any) =>
        apiPost(`/education/${tenantId}/enrollments`, data),
    updateEnrollment: (tenantId: string, id: string, data: any) =>
        apiPut(`/education/${tenantId}/enrollments/${id}`, data),

    // ─── Insurance ───
    listInsurancePlans: (tenantId: string, params?: { type?: string; coverageLevel?: string }) => {
        const qs = new URLSearchParams();
        if (params?.type) qs.set("type", params.type);
        if (params?.coverageLevel) qs.set("coverageLevel", params.coverageLevel);
        const q = qs.toString();
        return apiGet(`/insurance/${tenantId}/plans${q ? `?${q}` : ""}`);
    },
    createInsurancePlan: (tenantId: string, data: any) => apiPost(`/insurance/${tenantId}/plans`, data),
    updateInsurancePlan: (tenantId: string, id: string, data: any) => apiPut(`/insurance/${tenantId}/plans/${id}`, data),
    deleteInsurancePlan: (tenantId: string, id: string) => apiDelete(`/insurance/${tenantId}/plans/${id}`),
    listInsuranceQuotes: (tenantId: string, params?: { contactId?: string; status?: string }) => {
        const qs = new URLSearchParams();
        if (params?.contactId) qs.set("contactId", params.contactId);
        if (params?.status) qs.set("status", params.status);
        const q = qs.toString();
        return apiGet(`/insurance/${tenantId}/quotes${q ? `?${q}` : ""}`);
    },
    createInsuranceQuote: (tenantId: string, data: any) => apiPost(`/insurance/${tenantId}/quotes`, data),
    updateInsuranceQuoteStatus: (tenantId: string, id: string, status: string) =>
        apiPut(`/insurance/${tenantId}/quotes/${id}/status`, { status }),
    listInsurancePolicies: (tenantId: string, params?: { status?: string }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        const q = qs.toString();
        return apiGet(`/insurance/${tenantId}/policies${q ? `?${q}` : ""}`);
    },
    createInsurancePolicy: (tenantId: string, data: any) => apiPost(`/insurance/${tenantId}/policies`, data),
    listInsuranceClaims: (tenantId: string, params?: { policyId?: string; status?: string }) => {
        const qs = new URLSearchParams();
        if (params?.policyId) qs.set("policyId", params.policyId);
        if (params?.status) qs.set("status", params.status);
        const q = qs.toString();
        return apiGet(`/insurance/${tenantId}/claims${q ? `?${q}` : ""}`);
    },
    fileInsuranceClaim: (tenantId: string, data: any) => apiPost(`/insurance/${tenantId}/claims`, data),

    // ─── Home services ───
    listServiceRequests: (tenantId: string, params?: { status?: string; urgency?: string }) => {
        const qs = new URLSearchParams();
        if (params?.status) qs.set("status", params.status);
        if (params?.urgency) qs.set("urgency", params.urgency);
        const q = qs.toString();
        return apiGet(`/home-services/${tenantId}/requests${q ? `?${q}` : ""}`);
    },
    getServiceRequest: (tenantId: string, id: string) => apiGet(`/home-services/${tenantId}/requests/${id}`),
    createServiceRequest: (tenantId: string, data: any) => apiPost(`/home-services/${tenantId}/requests`, data),
    updateServiceRequest: (tenantId: string, id: string, data: any) => apiPut(`/home-services/${tenantId}/requests/${id}`, data),

    // ─── Real Estate Listings (inmobiliaria) ───
    listListings: (tenantId: string, params?: { transactionType?: string; status?: string }) => {
        const qs = new URLSearchParams();
        if (params?.transactionType) qs.set('transactionType', params.transactionType);
        if (params?.status) qs.set('status', params.status);
        const q = qs.toString();
        return apiGet(`/listings/${tenantId}${q ? `?${q}` : ''}`);
    },
    getListing: (tenantId: string, listingId: string) =>
        apiGet(`/listings/${tenantId}/listings/${listingId}`),
    createListing: (tenantId: string, data: any) =>
        apiPost(`/listings/${tenantId}`, data),
    updateListing: (tenantId: string, listingId: string, data: any) =>
        apiPut(`/listings/${tenantId}/listings/${listingId}`, data),
    deleteListing: (tenantId: string, listingId: string) =>
        apiDelete(`/listings/${tenantId}/listings/${listingId}`),
    searchListings: (tenantId: string, params: any) => {
        const qs = new URLSearchParams();
        Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
        return apiGet(`/listings/${tenantId}/search?${qs.toString()}`);
    },
    listListingZones: (tenantId: string) =>
        apiGet(`/listings/${tenantId}/zones`),
    setListingZone: (tenantId: string, data: { neighborhood: string; agentId: string; city?: string }) =>
        apiPost(`/listings/${tenantId}/zones`, data),
    removeListingZone: (tenantId: string, mappingId: string) =>
        apiDelete(`/listings/${tenantId}/zones/${mappingId}`),

    // ─── Financials (super_admin) ───
    getFinancialsOverview: () => apiGet("/financials/overview"),
    getMrrTrend: (months = 12) => apiGet(`/financials/mrr-trend?months=${months}`),
    getRevenueTrend: (months = 12) => apiGet(`/financials/revenue?months=${months}`),
    getChurnTrend: (months = 12) => apiGet(`/financials/churn-trend?months=${months}`),
    getCostsTrend: (months = 12) => apiGet(`/financials/costs?months=${months}`),
    getTenantProfitability: (month?: string) => apiGet(`/financials/tenant-profitability${month ? `?month=${month}` : ''}`),
    getTrialMetrics: () => apiGet("/financials/trial-metrics"),
    getInfraCosts: (year: number) => apiGet(`/financials/infra-costs?year=${year}`),
    saveInfraCost: (data: any) => apiPost("/financials/infra-costs", data),
    saveExchangeRate: (data: any) => apiPost("/financials/exchange-rates", data),
    generateSnapshot: (month: string) => apiPost("/financials/snapshot/generate", { month }),

    // ─── Vertical Analytics (super_admin) ───
    getVerticalOverview: (refresh = false) =>
        apiGet(`/vertical-analytics/overview${refresh ? '?refresh=true' : ''}`),
    getVerticalIndustry: (industry: string, refresh = false) =>
        apiGet(`/vertical-analytics/industry/${encodeURIComponent(industry)}${refresh ? '?refresh=true' : ''}`),
    getVerticalTenant: (tenantId: string, refresh = false) =>
        apiGet(`/vertical-analytics/tenant/${encodeURIComponent(tenantId)}${refresh ? '?refresh=true' : ''}`),
};

// ============================================
// HTTP method helpers
// ============================================

async function apiGet<T = any>(endpoint: string): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await authFetch(endpoint);
        const json = await res.json();
        if (!res.ok) return { success: false, error: json.message || `Error ${res.status}` };
        return json;
    } catch (err) {
        return { success: false, error: "Error de conexión" };
    }
}

async function apiPost<T = any>(endpoint: string, body: any): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await authFetch(endpoint, {
            method: "POST",
            body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) return { success: false, error: json.message || `Error ${res.status}` };
        return json;
    } catch (err) {
        return { success: false, error: "Error de conexión" };
    }
}

async function apiPut<T = any>(endpoint: string, body: any): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await authFetch(endpoint, {
            method: "PUT",
            body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) return { success: false, error: json.message || `Error ${res.status}` };
        return json;
    } catch (err) {
        return { success: false, error: "Error de conexión" };
    }
}

async function apiPatch<T = any>(endpoint: string, body: any): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await authFetch(endpoint, {
            method: "PATCH",
            body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) return { success: false, error: json.message || `Error ${res.status}` };
        return json;
    } catch (err) {
        return { success: false, error: "Error de conexión" };
    }
}

async function apiGetBlob(endpoint: string): Promise<Blob | null> {
    try {
        const res = await authFetch(endpoint);
        if (!res.ok) return null;
        return await res.blob();
    } catch {
        return null;
    }
}

async function apiDelete<T = any>(endpoint: string): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await authFetch(endpoint, { method: "DELETE" });
        const json = await res.json();
        if (!res.ok) return { success: false, error: json.message || `Error ${res.status}` };
        return json;
    } catch (err) {
        return { success: false, error: "Error de conexión" };
    }
}
