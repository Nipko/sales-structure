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

    me: () => apiPost("/auth/me", {}),

    // --- Tenants ---
    getTenants: () => apiGet("/tenants"),
    getTenant: (id: string) => apiGet(`/tenants/${id}`),

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
        apiPut(`/tenants/${id}`, data),

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
