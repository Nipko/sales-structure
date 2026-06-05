import * as SecureStore from 'expo-secure-store';
import type { AuthUser as SharedAuthUser } from '@parallext/shared';
import { API_URL } from './config';

const ACCESS_KEY = 'parallly_access';
const REFRESH_KEY = 'parallly_refresh';
const USER_KEY = 'parallly_user';
// Trusted-device token: lets future logins skip 2FA for 30 days. Persists across
// logout (it identifies the DEVICE, not the session) — only cleared if revoked.
const DEVICE_TRUST_KEY = 'parallly_device_trust';

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
    // Device-trust token — NOT cleared by clear()/logout on purpose.
    async getDeviceTrust(): Promise<string | null> { return SecureStore.getItemAsync(DEVICE_TRUST_KEY); },
    async setDeviceTrust(token: string) { await SecureStore.setItemAsync(DEVICE_TRUST_KEY, token); },
    async clearDeviceTrust() { await SecureStore.deleteItemAsync(DEVICE_TRUST_KEY); },
};

// ── Core fetch with auth + single refresh retry ──────────────
let refreshing: Promise<string | null> | null = null;

// Called when a refresh fails (session is dead) → AuthContext kicks back to login.
let authFailureHandler: (() => void) | null = null;
export function setOnAuthFailure(cb: (() => void) | null) { authFailureHandler = cb; }

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
        } else {
            // Refresh failed → the session is dead. Kick to login instead of
            // leaving the user stuck inside the app with everything failing.
            authFailureHandler?.();
        }
    }
    return res;
}

// Multipart upload (no JSON content-type so fetch sets the multipart boundary).
// Mirrors authFetch's single 401-refresh-retry.
async function authFetchForm(path: string, form: FormData): Promise<Response> {
    const { access } = await tokens.get();
    const headers: Record<string, string> = {};
    if (access) headers.Authorization = `Bearer ${access}`;
    let res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: form as any });
    if (res.status === 401 && access) {
        if (!refreshing) refreshing = doRefresh();
        const newToken = await refreshing;
        refreshing = null;
        if (newToken) {
            headers.Authorization = `Bearer ${newToken}`;
            res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: form as any });
        } else {
            authFailureHandler?.();
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
    // rememberMe=true → long-lived session (mobile standard). deviceTrustToken (if
    // present) lets the backend skip the 2FA challenge on a previously trusted device.
    async login(email: string, password: string, deviceTrustToken?: string, force = false) {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, rememberMe: true, deviceTrustToken, force }),
        });
        return res.json();
    },

    async googleLogin(idToken: string, deviceTrustToken?: string, force = false) {
        const res = await fetch(`${API_URL}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, rememberMe: true, deviceTrustToken, force }),
        });
        return res.json();
    },

    // Kill the server-side session so a later login doesn't hit "session already open".
    async logout(refreshToken?: string) {
        try {
            await fetch(`${API_URL}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });
        } catch { /* best effort */ }
    },

    // 2FA challenge during login (public — uses the twoFAToken from login/google).
    // trustDevice=true → backend registers this device and returns a deviceTrustToken.
    async verify2FA(twoFAToken: string, code: string, method: 'totp' | 'email' | 'backup', rememberMe = true, trustDevice = false) {
        const res = await fetch(`${API_URL}/auth/2fa/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ twoFAToken, code, method, rememberMe, trustDevice }),
        });
        return res.json();
    },

    async send2FAEmail(twoFAToken: string) {
        const res = await fetch(`${API_URL}/auth/2fa/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ twoFAToken }),
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
    // Outbound media: upload the file, then send a message carrying its URL.
    uploadMedia: async (tenantId: string, asset: { uri: string; fileName?: string; mimeType?: string }) => {
        try {
            const form = new FormData();
            form.append('file', { uri: asset.uri, name: asset.fileName || `photo_${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' } as any);
            const res = await authFetchForm(`/media/upload/${tenantId}`, form);
            return await res.json();
        } catch (e: any) {
            return { success: false, error: e?.message || 'upload_error' };
        }
    },
    sendMediaMessage: (tenantId: string, id: string, mediaUrl: string, caption: string, agentId?: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/message`, {
            method: 'POST', body: JSON.stringify({ agentId, content: caption || '', type: 'image', mediaUrl, caption }),
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
    returnToAI: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/return-to-ai`, { method: 'PUT', body: '{}' }),
    snoozeConversation: (tenantId: string, id: string, snoozeUntil: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/snooze`, { method: 'PUT', body: JSON.stringify({ snoozeUntil }) }),
    unsnoozeConversation: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/unsnooze`, { method: 'PUT', body: '{}' }),
    reopenConversation: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/reopen`, { method: 'POST', body: '{}' }),
    addNote: (tenantId: string, id: string, content: string, agentId?: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/note`, { method: 'POST', body: JSON.stringify({ content, agentId }) }),
    copilotRewrite: (conversationId: string, draft: string, tone: string) =>
        json(`/copilot/${conversationId}/rewrite`, { method: 'POST', body: JSON.stringify({ draft, tone }) }),
    copilotSummary: (conversationId: string) => json(`/copilot/${conversationId}/summary`),
    setAvailability: (userId: string, status: string) =>
        json(`/agent-console/status/${userId}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    getAgentsStatus: (tenantId: string) =>
        json(`/agent-console/agents/${tenantId}/status`),
    getCannedResponses: (tenantId: string) => json(`/agent-console/canned/${tenantId}`),
    getMacros: (tenantId: string) => json(`/agent-console/macros/${tenantId}`),
    executeMacro: (tenantId: string, macroId: string, conversationId: string, agentId: string) =>
        json(`/agent-console/macros/${tenantId}/${macroId}/execute`, { method: 'POST', body: JSON.stringify({ conversationId, agentId }) }),

    // Vertical config (terminology per industry)
    getVerticalConfig: (tenantId: string) => json(`/verticals/${tenantId}`),

    // CRM
    getLeads: (tenantId: string, params?: string) =>
        json(`/crm/leads/${tenantId}${params ? `?${params}` : ''}`),
    getLead: (tenantId: string, leadId: string) => json(`/crm/leads/${tenantId}/${leadId}`),
    // Create a lead. Accepts snake_case fields: first_name, last_name, phone, email, source, notes…
    createLead: (tenantId: string, data: Record<string, any>) =>
        json(`/crm/leads/${tenantId}`, { method: 'POST', body: JSON.stringify(data) }),
    // Editable CRM (verified backend routes). updateLead takes a partial { tags?, ...fields }.
    updateLead: (tenantId: string, leadId: string, data: Record<string, any>) =>
        json(`/crm/leads/${tenantId}/${leadId}`, { method: 'PUT', body: JSON.stringify(data) }),
    archiveLead: (tenantId: string, leadId: string) =>
        json(`/crm/leads/${tenantId}/${leadId}`, { method: 'DELETE' }),
    restoreLead: (tenantId: string, leadId: string) =>
        json(`/crm/leads/${tenantId}/${leadId}/restore`, { method: 'PUT', body: '{}' }),
    getLeadNotes: (tenantId: string, leadId: string) => json(`/crm/notes/${tenantId}/${leadId}`),
    addLeadNote: (tenantId: string, leadId: string, content: string, createdBy?: string) =>
        json(`/crm/notes/${tenantId}`, { method: 'POST', body: JSON.stringify({ leadId, content, createdBy }) }),
    getLeadTimeline: (tenantId: string, leadId: string) => json(`/crm/timeline/${tenantId}/${leadId}`),
    // Tasks / follow-ups (lead-scoped; create requires leadId).
    getTasks: (tenantId: string, params?: string) =>
        json(`/crm/tasks/${tenantId}${params ? `?${params}` : ''}`),
    createTask: (tenantId: string, data: { leadId: string; title: string; dueAt?: string; assignedTo?: string; createdBy?: string; type?: string; description?: string }) =>
        json(`/crm/tasks/${tenantId}`, { method: 'POST', body: JSON.stringify(data) }),
    updateTaskStatus: (tenantId: string, taskId: string, status: string) =>
        json(`/crm/tasks/${tenantId}/${taskId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

    // Appointments
    getAppointments: (tenantId: string, params?: string) =>
        json(`/appointments/${tenantId}${params ? `?${params}` : ''}`),
    updateAppointment: (tenantId: string, id: string, data: any) =>
        json(`/appointments/${tenantId}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    cancelAppointment: (tenantId: string, id: string, reason?: string) =>
        json(`/appointments/${tenantId}/${id}/cancel`, { method: 'PUT', body: JSON.stringify({ reason }) }),
    // Booking: services + available slots (for rescheduling / creating).
    createAppointment: (tenantId: string, data: Record<string, any>) =>
        json(`/appointments/${tenantId}`, { method: 'POST', body: JSON.stringify(data) }),
    getBookableServices: (tenantId: string) => json(`/appointments/${tenantId}/services`),
    getBookableSlots: (tenantId: string, date: string, serviceId: string, userId?: string) =>
        json(`/appointments/${tenantId}/bookable-slots?date=${date}&serviceId=${serviceId}${userId ? `&userId=${userId}` : ''}`),

    // Analytics
    getResolutionStats: (tenantId: string, start: string, end: string) =>
        json(`/dashboard-analytics/ai-resolution/${tenantId}?start=${start}&end=${end}`),
    getOverviewKpis: (tenantId: string, start: string, end: string) =>
        json(`/dashboard-analytics/overview-kpis/${tenantId}?start=${start}&end=${end}`),

    // Pipeline
    getPipelineStages: (tenantId: string) => json(`/pipeline/stages/${tenantId}`),
    getKanban: (tenantId: string) => json(`/pipeline/kanban/${tenantId}`),
    moveDeal: (tenantId: string, dealId: string, stageId: string, agentId?: string) =>
        json(`/pipeline/deals/${tenantId}/${dealId}/move`, { method: 'PUT', body: JSON.stringify(agentId ? { stageId, agentId } : { stageId }) }),
    getDeal: (tenantId: string, dealId: string) => json(`/pipeline/deals/${tenantId}/${dealId}`),
    updateDeal: (tenantId: string, dealId: string, data: Record<string, any>) =>
        json(`/pipeline/deals/${tenantId}/${dealId}`, { method: 'PUT', body: JSON.stringify(data) }),

    // Native push (Expo token)
    subscribeExpoPush: (token: string) =>
        json('/push/expo-subscribe', { method: 'POST', body: JSON.stringify({ token }) }),
};

