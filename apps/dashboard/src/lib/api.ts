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
    getPersonaTemplates: () =>
        apiGet("/persona/templates"),

    applySetupTemplate: (tenantId: string, data: { templateId: string; customizations?: any; selectedChannels?: string[] }) =>
        apiPost(`/persona/${tenantId}/setup-wizard`, data),

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

    // --- Users ---
    getUsers: () => apiGet("/auth/users"),

    registerUser: (data: { email: string; password: string; firstName: string; lastName: string; role?: string; tenantId?: string }) =>
        apiPost("/auth/register", data),

    // --- Tenant CRUD ---
    createTenant: (data: { name: string; slug: string; industry: string; language?: string; plan?: string }) =>
        apiPost("/tenants", data),

    updateTenant: (id: string, data: any) =>
        apiPatch(`/tenants/${id}`, data),

    deactivateTenant: (id: string) =>
        apiPost(`/tenants/${id}/deactivate`, {}),

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
        apiGet(`/appointments/${tenantId}/calendar/integrations`),
    getCalendarEvents: (tenantId: string, startDate: string, endDate: string) =>
        apiGet(`/appointments/${tenantId}/calendar/events?startDate=${startDate}&endDate=${endDate}`),
    connectGoogleCalendar: (tenantId: string) =>
        apiGet(`/appointments/${tenantId}/calendar/google/connect`),
    connectMicrosoftCalendar: (tenantId: string) =>
        apiGet(`/appointments/${tenantId}/calendar/microsoft/connect`),
    disconnectCalendar: (tenantId: string, integrationId: string) =>
        apiDelete(`/appointments/${tenantId}/calendar/${integrationId}`),
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

    // --- Phase 3: Anomalies, Cohorts ---
    getDashboardAnomalies: (tenantId: string) =>
        apiGet(`/dashboard-analytics/anomalies/${tenantId}`),

    getDashboardCohorts: (tenantId: string, months?: number) =>
        apiGet(`/dashboard-analytics/cohorts/${tenantId}?months=${months || 6}`),

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
    }
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
