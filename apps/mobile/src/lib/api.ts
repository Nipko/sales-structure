import * as SecureStore from 'expo-secure-store';
import type { AuthUser as SharedAuthUser } from '@parallext/shared';
import { API_URL } from './config';

const ACCESS_KEY = 'parallly_access';
const REFRESH_KEY = 'parallly_refresh';
const USER_KEY = 'parallly_user';

// Shared contract (packages/shared) + the display name returned by /auth/login.
export type AuthUser = SharedAuthUser & { name?: string };

// ── Token storage (SecureStore) ──────────────────────────────
export const tokens = {
    async get(): Promise<{ access: string | null; refresh: string | null }> {
        const [access, refresh] = await Promise.all([
            SecureStore.getItemAsync(ACCESS_KEY),
            SecureStore.getItemAsync(REFRESH_KEY),
        ]);
        return { access, refresh };
    },
    async set(access: string, refresh?: string) {
        await SecureStore.setItemAsync(ACCESS_KEY, access);
        if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
    },
    async clear() {
        await Promise.all([
            SecureStore.deleteItemAsync(ACCESS_KEY),
            SecureStore.deleteItemAsync(REFRESH_KEY),
            SecureStore.deleteItemAsync(USER_KEY),
        ]);
    },
    async setUser(user: AuthUser) { await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)); },
    async getUser(): Promise<AuthUser | null> {
        const raw = await SecureStore.getItemAsync(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    },
};

// ── Core fetch with auth + single refresh retry ──────────────
let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
    const { refresh } = await tokens.get();
    if (!refresh) return null;
    try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: refresh }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.success && data.data?.accessToken) {
            await tokens.set(data.data.accessToken, data.data.refreshToken);
            return data.data.accessToken;
        }
        return null;
    } catch {
        return null;
    }
}

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const { access } = await tokens.get();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
    };
    if (access) headers.Authorization = `Bearer ${access}`;

    let res = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (res.status === 401 && access) {
        if (!refreshing) refreshing = doRefresh();
        const newToken = await refreshing;
        refreshing = null;
        if (newToken) {
            headers.Authorization = `Bearer ${newToken}`;
            res = await fetch(`${API_URL}${path}`, { ...options, headers });
        }
    }
    return res;
}

async function json<T = any>(path: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await authFetch(path, options);
        return await res.json();
    } catch (e: any) {
        return { success: false, error: e?.message || 'network_error' };
    }
}

// ── Public API ───────────────────────────────────────────────
export const api = {
    async login(email: string, password: string) {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        return res.json();
    },

    // Agent console (inbox)
    getInbox: (tenantId: string, filter?: string) =>
        json(`/agent-console/inbox/${tenantId}${filter ? `?filter=${filter}` : ''}`),
    getConversation: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}`),
    sendMessage: (tenantId: string, id: string, content: string, agentId?: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/message`, {
            method: 'POST', body: JSON.stringify({ content, agentId }),
        }),
    assignConversation: (tenantId: string, id: string, agentId: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/assign`, {
            method: 'PUT', body: JSON.stringify({ agentId }),
        }),
    resolveConversation: (tenantId: string, id: string, agentId?: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/resolve`, {
            method: 'PUT', body: JSON.stringify({ agentId }),
        }),
    getAiSuggestion: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/suggest`),
    setAvailability: (userId: string, status: string) =>
        json(`/agent-console/status/${userId}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    getCannedResponses: (tenantId: string) => json(`/agent-console/canned/${tenantId}`),

    // CRM
    getLeads: (tenantId: string, params?: string) =>
        json(`/crm/leads/${tenantId}${params ? `?${params}` : ''}`),
    getLead: (tenantId: string, leadId: string) => json(`/crm/leads/${tenantId}/${leadId}`),

    // Appointments
    getAppointments: (tenantId: string, params?: string) =>
        json(`/appointments/${tenantId}${params ? `?${params}` : ''}`),
    updateAppointment: (tenantId: string, id: string, data: any) =>
        json(`/appointments/${tenantId}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    cancelAppointment: (tenantId: string, id: string, reason?: string) =>
        json(`/appointments/${tenantId}/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ reason }) }),

    // Analytics
    getResolutionStats: (tenantId: string, start: string, end: string) =>
        json(`/dashboard-analytics/ai-resolution/${tenantId}?start=${start}&end=${end}`),
    getOverviewKpis: (tenantId: string, start: string, end: string) =>
        json(`/dashboard-analytics/overview-kpis/${tenantId}?start=${start}&end=${end}`),

    // Pipeline
    getPipelineStages: (tenantId: string) => json(`/pipeline/stages/${tenantId}`),
    getKanban: (tenantId: string) => json(`/pipeline/kanban/${tenantId}`),
    moveDeal: (tenantId: string, dealId: string, stageId: string) =>
        json(`/pipeline/deals/${tenantId}/${dealId}/move`, { method: 'PUT', body: JSON.stringify({ stageId }) }),

    // Native push (Expo token)
    subscribeExpoPush: (token: string) =>
        json('/push/expo-subscribe', { method: 'POST', body: JSON.stringify({ token }) }),
};

