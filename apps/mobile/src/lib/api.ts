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

// Resultado del último refresh fallido: 'dead' = el SERVIDOR rechazó el token
// (sesión realmente muerta → volver al login); 'network' = fallo transitorio
// (sin señal, túnel caído, 5xx) → la sesión sigue siendo válida y NO hay que
// desloguear: cada request individual falla y las pantallas muestran su error.
// Antes cualquier fallo (incluido offline) borraba los tokens y expulsaba al
// agente al login — en redes LatAm eso era "me pide loguearme cada rato".
let lastRefreshFailure: 'dead' | 'network' | null = null;

async function doRefresh(): Promise<string | null> {
    const { refresh } = await tokens.get();
    if (!refresh) { lastRefreshFailure = 'dead'; return null; }
    try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: refresh }),
        });
        const data = await res.json().catch(() => null);
        if (data?.success && data.data?.accessToken) {
            await tokens.set(data.data.accessToken, data.data.refreshToken);
            lastRefreshFailure = null;
            return data.data.accessToken;
        }
        // Sesión muerta SOLO con un rechazo inequívoco del API (401/400 con
        // cuerpo JSON). Un 403/429 de Cloudflare (WAF, challenge, rate-limit)
        // devuelve HTML → data null → transitorio: desloguear ahí recrearía el
        // "me pide loguearme cada rato".
        lastRefreshFailure = (res.status === 401 || res.status === 400) && data !== null ? 'dead' : 'network';
        return null;
    } catch {
        lastRefreshFailure = 'network';
        return null;
    }
}

/**
 * Force-refresh the access token (single-flight). Used by the realtime socket
 * layer: when the socket's auth is rejected (token expired), it refreshes and
 * reconnects — otherwise live updates silently stop until the next HTTP 401.
 */
export async function refreshAccessToken(): Promise<string | null> {
    if (!refreshing) refreshing = doRefresh();
    const tok = await refreshing;
    refreshing = null;
    return tok;
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
        } else if (lastRefreshFailure === 'dead') {
            // Solo cuando el servidor rechazó la sesión de verdad. Un fallo de
            // red mantiene la sesión: el request falla y se reintenta después.
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
        } else if (lastRefreshFailure === 'dead') {
            authFailureHandler?.();
        }
    }
    return res;
}

async function json<T = any>(path: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await authFetch(path, options);
        let body: any = null;
        try { body = await res.json(); } catch { body = null; }
        if (!res.ok) {
            // Nest error envelope is {statusCode, message, error} — no `success` field.
            // Normalize so every caller can rely on {success:false, error} instead of
            // reading a 400 body as if it were a successful payload (false-success bug).
            const msg = Array.isArray(body?.message) ? body.message.join(', ')
                : typeof body?.message === 'string' ? body.message
                : typeof body?.error === 'string' ? body.error
                : `http_${res.status}`;
            return { success: false, error: msg };
        }
        return body ?? { success: false, error: 'empty_response' };
    } catch (e: any) {
        return { success: false, error: e?.message || 'network_error' };
    }
}

// ── Public API ───────────────────────────────────────────────
export const api = {
    // rememberMe=true → long-lived session (mobile standard). deviceTrustToken (if
    // present) lets the backend skip the 2FA challenge on a previously trusted device.
    // clientType 'mobile' → el backend abre una sesión PROPIA del teléfono
    // (TTL 14d, coexiste con la del dashboard): entrar a la web ya no mata la
    // sesión de la app ni al revés.
    async login(email: string, password: string, deviceTrustToken?: string, force = false) {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, rememberMe: true, deviceTrustToken, force, clientType: 'mobile' }),
        });
        return res.json();
    },

    async googleLogin(idToken: string, deviceTrustToken?: string, force = false) {
        const res = await fetch(`${API_URL}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, rememberMe: true, deviceTrustToken, force, clientType: 'mobile' }),
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
            body: JSON.stringify({ twoFAToken, code, method, rememberMe, trustDevice, clientType: 'mobile' }),
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
    getInbox: (tenantId: string, filter?: string, opts?: { limit?: number; offset?: number; agentId?: string }) => {
        const params = new URLSearchParams();
        if (filter) params.set('filter', filter);
        // The 'mine' filter is scoped server-side by agentId — without it the
        // endpoint has nothing to match and always returns an empty list.
        if (opts?.agentId) params.set('agentId', opts.agentId);
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.offset) params.set('offset', String(opts.offset));
        const qs = params.toString();
        return json(`/agent-console/inbox/${tenantId}${qs ? `?${qs}` : ''}`);
    },
    getConversation: (tenantId: string, id: string, opts?: { limit?: number; before?: string }) => {
        const params = new URLSearchParams();
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.before) params.set('before', opts.before);
        const qs = params.toString();
        return json(`/agent-console/conversation/${tenantId}/${id}${qs ? `?${qs}` : ''}`);
    },
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
    sendMediaMessage: (tenantId: string, id: string, mediaUrl: string, caption: string, agentId?: string, type: string = 'image', filename?: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/message`, {
            method: 'POST', body: JSON.stringify({ agentId, content: caption || '', type, mediaUrl, caption, filename }),
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

    // Business identity (empresa primaria: nombre, logo_url…) — para el BrandHeader.
    getBusinessInfo: (tenantId: string) => json(`/business-info/${tenantId}`),

    // Vacation rental (vertical turismo): la pestaña de agenda muestra ESTADÍAS
    // de propiedades, no citas de servicios.
    getProperties: (tenantId: string) => json(`/vacation-rental/${tenantId}/properties`),
    getUpcomingStays: (tenantId: string, from?: string) =>
        json(`/vacation-rental/${tenantId}/bookings${from ? `?from=${encodeURIComponent(from)}` : ''}`),
    createPropertyBooking: (tenantId: string, propertyId: string, data: Record<string, any>) =>
        json(`/vacation-rental/${tenantId}/properties/${propertyId}/bookings`, { method: 'POST', body: JSON.stringify(data) }),
    cancelPropertyBooking: (tenantId: string, bookingId: string) =>
        json(`/vacation-rental/${tenantId}/bookings/${bookingId}/cancel`, { method: 'PUT', body: '{}' }),

    // Vertical workspaces. The mobile "Operaciones" tab reads the domain's
    // real records instead of relabelling every business flow as an appointment.
    getTourBookings: (tenantId: string) => json(`/tours/${tenantId}/bookings`),
    getRestaurantOrders: (tenantId: string, status?: string) =>
        json(`/restaurants/${tenantId}/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    updateRestaurantOrderStatus: (tenantId: string, orderId: string, status: string) =>
        json(`/restaurants/${tenantId}/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    getOrdersOverview: (tenantId: string) => json(`/orders/overview/${tenantId}`),
    updateOrderStatus: (tenantId: string, orderId: string, status: string) =>
        json(`/orders/${tenantId}/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    getFitnessClasses: (tenantId: string, from: string, to: string) =>
        json(`/gyms/${tenantId}/classes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`),
    getEducationEnrollments: (tenantId: string) => json(`/education/${tenantId}/enrollments`),
    getEducationCohorts: (tenantId: string) => json(`/education/${tenantId}/cohorts`),
    getInsuranceQuotes: (tenantId: string) => json(`/insurance/${tenantId}/quotes`),
    getInsurancePolicies: (tenantId: string) => json(`/insurance/${tenantId}/policies`),
    getInsuranceClaims: (tenantId: string) => json(`/insurance/${tenantId}/claims`),
    getServiceRequests: (tenantId: string) => json(`/home-services/${tenantId}/requests`),
    getPhotoSessions: (tenantId: string) => json(`/photography/${tenantId}/sessions`),
    getTestDrives: (tenantId: string) => json(`/vehicles/${tenantId}/test-drives/list`),
    // Appointment context selectors. Shapes differ by backend module:
    // listings/pets return arrays; vehicles returns { items, total }.
    getRealEstateListings: (tenantId: string) => json(`/listings/${tenantId}`),
    getPets: (tenantId: string, params?: string) =>
        json(`/pets/${tenantId}/all${params ? `?${params}` : ''}`),
    getVehicles: (tenantId: string, params?: string) =>
        json(`/vehicles/${tenantId}${params ? `?${params}` : ''}`),

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

    // Channel accounts (multi-channel-per-type): which connections the tenant has.
    getChannelsOverview: () => json('/channels/overview'),

    // WhatsApp Templates (outbound HSM)
    getWhatsappTemplates: () =>
        json('/channels/whatsapp/templates'),
    // phoneNumberId: multi-number tenants choose the sending number; the API
    // defaults to the oldest connected number when omitted.
    sendWhatsappTemplate: (toPhone: string, templateName: string, language: string, components?: any[], phoneNumberId?: string) =>
        json('/channels/whatsapp/send/template', {
            method: 'POST',
            body: JSON.stringify({ toPhone, templateName, language, components: components || [], phoneNumberId }),
        }),
    sendWhatsappText: (toPhone: string, text: string, conversationId?: string, phoneNumberId?: string) =>
        json('/channels/whatsapp/send/text', {
            method: 'POST',
            body: JSON.stringify({ toPhone, text, conversationId, phoneNumberId }),
        }),

    // Contacts search (for outbound contact picker)
    searchContacts: (tenantId: string, query: string) =>
        json(`/crm/leads/${tenantId}?search=${encodeURIComponent(query)}&limit=20`),

    // AI utilities
    nextBestAction: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/next-action`),
    translateText: (tenantId: string, text: string, targetLanguage = 'es') =>
        json(`/agent-console/translate/${tenantId}`, {
            method: 'POST',
            body: JSON.stringify({ text, targetLanguage }),
        }),
    scanBusinessCard: (tenantId: string, imageBase64: string, mimeType = 'image/jpeg') =>
        json(`/agent-console/scan-card/${tenantId}`, {
            method: 'POST',
            body: JSON.stringify({ imageBase64, mimeType }),
        }),
};

