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
    getInbox: (tenantId: string, status?: string) =>
        apiGet(`/agent-console/inbox/${tenantId}${status ? `?status=${status}` : ""}`),

    getConversation: (tenantId: string, id: string) =>
        apiGet(`/agent-console/conversation/${tenantId}/${id}`),

    sendMessage: (tenantId: string, id: string, content: string) =>
        apiPost(`/agent-console/conversation/${tenantId}/${id}/message`, { content }),

    assignConversation: (tenantId: string, id: string, agentId: string) =>
        apiPut(`/agent-console/conversation/${tenantId}/${id}/assign`, { agentId }),

    resolveConversation: (tenantId: string, id: string) =>
        apiPut(`/agent-console/conversation/${tenantId}/${id}/resolve`, {}),

    addNote: (tenantId: string, id: string, content: string) =>
        apiPost(`/agent-console/conversation/${tenantId}/${id}/note`, { content }),

    getStats: (tenantId: string) =>
        apiGet(`/agent-console/stats/${tenantId}`),

    getCannedResponses: (tenantId: string) =>
        apiGet(`/agent-console/canned-responses/${tenantId}`),

    getAISuggestion: (tenantId: string, id: string) =>
        apiGet(`/agent-console/ai-suggest/${tenantId}/${id}`),

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
        apiGet(`/pipeline/automation/${tenantId}`),

    createRule: (tenantId: string, data: any) =>
        apiPost(`/pipeline/automation/${tenantId}`, data),

    toggleRule: (tenantId: string, ruleId: string) =>
        apiPut(`/pipeline/automation/${tenantId}/${ruleId}/toggle`, {}),

    deleteRule: (tenantId: string, ruleId: string) =>
        apiDelete(`/pipeline/automation/${tenantId}/${ruleId}`),

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
    getOverviewStats: (tenantId: string) =>
        apiGet(`/analytics/overview/${tenantId}`),

    getAgentLeaderboard: (tenantId: string) =>
        apiGet(`/analytics/agents/${tenantId}`),

    getCSATResponses: (tenantId: string) =>
        apiGet(`/analytics/csat/${tenantId}`),

    getCSATDistribution: (tenantId: string) =>
        apiGet(`/analytics/csat/${tenantId}/distribution`),

    submitCSAT: (tenantId: string, data: any) =>
        apiPost(`/analytics/csat/${tenantId}`, data),

    // --- Settings ---
    getApiKeys: () => apiGet("/settings/api-keys"),
    setApiKey: (provider: string, key: string) =>
        apiPost("/settings/api-keys", { provider, key }),
    deleteApiKey: (provider: string) =>
        apiDelete(`/settings/api-keys/${provider}`),

    // --- Users ---
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
