import * as SecureStore from 'expo-secure-store';
import type { AuthUser as SharedAuthUser } from '@parallext/shared';
import { API_URL } from './config';
import { pagedQueryString, type PagedQuery } from './pagination';

const ACCESS_KEY = 'parallly_access';
const REFRESH_KEY = 'parallly_refresh';
const USER_KEY = 'parallly_user';
// Trusted-device token: lets future logins skip 2FA for 30 days. Persists across
// logout (it identifies the DEVICE, not the session) — only cleared if revoked.
const DEVICE_TRUST_KEY = 'parallly_device_trust';
export const AUTH_LOGOUT_TIMEOUT_MS = 2_000;

export interface ApiResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    /** Stable backend error identifier when the response provides one. */
    errorCode?: string;
    /** Human-readable backend detail, kept separate from the stable identifier. */
    message?: string;
    [key: string]: any;
}

function responseError(body: any, status: number): string {
    return Array.isArray(body?.message) ? body.message.join(', ')
        : typeof body?.message === 'string' ? body.message
        : typeof body?.error === 'string' ? body.error
        : `http_${status}`;
}

/**
 * Parse an HTTP response without ever leaking a JSON SyntaxError to the UI.
 * Cloudflare/proxy failures and 204/empty bodies are valid transport outcomes,
 * but they are not successful API envelopes.
 */
export async function parseApiResponse<T = any>(res: Response): Promise<ApiResult<T>> {
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }

    if (!res.ok) {
        const rawError = typeof body?.error === 'string' ? body.error : undefined;
        const errorCode = rawError && /^[a-z][a-z0-9_]*$/.test(rawError) ? rawError : undefined;
        const message = typeof body?.message === 'string' ? body.message : undefined;
        return {
            success: false,
            error: responseError(body, res.status),
            ...(errorCode ? { errorCode } : {}),
            ...(message ? { message } : {}),
        };
    }
    if (body === null || body === undefined) {
        return { success: false, error: 'empty_response' };
    }
    return body as ApiResult<T>;
}

/** Convert a resolved error envelope into a rejection for try/catch mutations. */
export function requireApiSuccess<T extends ApiResult<any>>(
    result: T | null | undefined,
    fallback = 'request_failed',
): T {
    if (!result?.success) throw new Error(result?.error || fallback);
    return result;
}

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

async function publicJson<T = any>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
    try {
        const res = await fetch(`${API_URL}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options?.headers as Record<string, string> || {}),
            },
        });
        return await parseApiResponse<T>(res);
    } catch (e: any) {
        return { success: false, error: e?.message || 'network_error' };
    }
}

async function json<T = any>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
    try {
        const res = await authFetch(path, options);
        return await parseApiResponse<T>(res);
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
        return publicJson('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password, rememberMe: true, deviceTrustToken, force, clientType: 'mobile' }),
        });
    },

    async googleLogin(idToken: string, deviceTrustToken?: string, force = false) {
        return publicJson('/auth/google', {
            method: 'POST',
            body: JSON.stringify({ idToken, rememberMe: true, deviceTrustToken, force, clientType: 'mobile' }),
        });
    },

    // Kill the server-side session so a later login doesn't hit "session already open".
    async logout(refreshToken?: string) {
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const request = fetch(`${API_URL}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
                signal: controller.signal,
            });
            const deadline = new Promise<void>((resolve) => {
                timeout = setTimeout(() => { controller.abort(); resolve(); }, AUTH_LOGOUT_TIMEOUT_MS);
            });
            await Promise.race([request.then(() => undefined), deadline]);
        } catch { /* best effort */ }
        finally { if (timeout) clearTimeout(timeout); }
    },

    // 2FA challenge during login (public — uses the twoFAToken from login/google).
    // trustDevice=true → backend registers this device and returns a deviceTrustToken.
    async verify2FA(twoFAToken: string, code: string, method: 'totp' | 'email' | 'backup', rememberMe = true, trustDevice = false) {
        return publicJson('/auth/2fa/verify', {
            method: 'POST',
            body: JSON.stringify({ twoFAToken, code, method, rememberMe, trustDevice, clientType: 'mobile' }),
        });
    },

    async send2FAEmail(twoFAToken: string) {
        return publicJson('/auth/2fa/send-email', {
            method: 'POST',
            body: JSON.stringify({ twoFAToken }),
        });
    },

    // Agent console (inbox)
    getInbox: (tenantId: string, filter?: string, opts?: { limit?: number; offset?: number }) => {
        const params = new URLSearchParams();
        if (filter) params.set('filter', filter);
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
    sendMessage: (tenantId: string, id: string, content: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/message`, {
            method: 'POST', body: JSON.stringify({ content }),
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
    sendMediaMessage: (tenantId: string, id: string, mediaUrl: string, caption: string, type: string = 'image', filename?: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/message`, {
            method: 'POST', body: JSON.stringify({ content: caption || '', type, mediaUrl, caption, filename }),
        }),
    assignConversation: (tenantId: string, id: string, agentId: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/assign`, {
            method: 'PUT', body: JSON.stringify({ agentId }),
        }),
    claimConversation: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/claim`, {
            method: 'PUT', body: '{}',
        }),
    resolveConversation: (tenantId: string, id: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/resolve`, {
            method: 'PUT', body: '{}',
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
    addNote: (tenantId: string, id: string, content: string) =>
        json(`/agent-console/conversation/${tenantId}/${id}/note`, { method: 'POST', body: JSON.stringify({ content }) }),
    copilotRewrite: (conversationId: string, draft: string, tone: string) =>
        json(`/copilot/${conversationId}/rewrite`, { method: 'POST', body: JSON.stringify({ draft, tone }) }),
    copilotSummary: (conversationId: string) => json(`/copilot/${conversationId}/summary`),
    setAvailability: (userId: string, status: string) =>
        json(`/agent-console/status/${userId}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    getAgentsStatus: (tenantId: string) =>
        json(`/agent-console/agents/${tenantId}/status`),
    getCannedResponses: (tenantId: string) => json(`/agent-console/canned/${tenantId}`),
    getMacros: (tenantId: string) => json(`/agent-console/macros/${tenantId}`),
    executeMacro: (tenantId: string, macroId: string, conversationId: string) =>
        json(`/agent-console/macros/${tenantId}/${macroId}/execute`, { method: 'POST', body: JSON.stringify({ conversationId }) }),

    // Vertical config (terminology per industry)
    getVerticalConfig: (tenantId: string) => json(`/verticals/${tenantId}`),
    getEffectiveVerticalProfile: (tenantId: string) => json(`/verticals/${tenantId}/effective-profile`),

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
    getTourPackages: (tenantId: string) => json(`/tours/${tenantId}/packages`),
    getTourAvailability: (tenantId: string, packageId: string, date: string, partySize: number) =>
        json(`/tours/${tenantId}/packages/${packageId}/availability?date=${encodeURIComponent(date)}&partySize=${encodeURIComponent(String(partySize))}`),
    createTourBooking: (tenantId: string, data: Record<string, any>) =>
        json(`/tours/${tenantId}/bookings`, { method: 'POST', body: JSON.stringify(data) }),
    cancelTourBooking: (tenantId: string, bookingId: string) =>
        json(`/tours/${tenantId}/bookings/${bookingId}/cancel`, { method: 'PUT', body: '{}' }),
    getRestaurantOrders: (tenantId: string, status?: string) =>
        json(`/restaurants/${tenantId}/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    getRestaurantItems: (tenantId: string, categoryId?: string) =>
        json(`/restaurants/${tenantId}/items?availableOnly=true${categoryId ? `&categoryId=${encodeURIComponent(categoryId)}` : ''}`),
    getRestaurantOrder: (tenantId: string, orderId: string) =>
        json(`/restaurants/${tenantId}/orders/${orderId}`),
    createRestaurantOrder: (tenantId: string, data: Record<string, any>) =>
        json(`/restaurants/${tenantId}/orders`, { method: 'POST', body: JSON.stringify(data) }),
    updateRestaurantOrderStatus: (tenantId: string, orderId: string, status: string) =>
        json(`/restaurants/${tenantId}/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    getInventoryProducts: (tenantId: string) => json(`/inventory/products/${tenantId}`),
    getOrdersOverview: (tenantId: string) => json(`/orders/overview/${tenantId}`),
    getOrderContacts: (tenantId: string, query: PagedQuery = {}) => {
        const params = pagedQueryString(query);
        return json(`/orders/contacts/${tenantId}${params ? `?${params}` : ''}`);
    },
    createOrder: (tenantId: string, data: Record<string, any>) =>
        json(`/orders/${tenantId}`, { method: 'POST', body: JSON.stringify(data) }),
    updateOrderStatus: (tenantId: string, orderId: string, status: string) =>
        json(`/orders/${tenantId}/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    getFitnessClasses: (tenantId: string, from: string, to: string) =>
        json(`/gyms/${tenantId}/classes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`),
    getGymMembers: (tenantId: string, search?: string) =>
        json(`/gyms/${tenantId}/members?limit=200${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    createFitnessClass: (tenantId: string, data: Record<string, any>) =>
        json(`/gyms/${tenantId}/classes`, { method: 'POST', body: JSON.stringify(data) }),
    cancelFitnessClass: (tenantId: string, classId: string, data: Record<string, any> = {}) =>
        json(`/gyms/${tenantId}/classes/${classId}/cancel`, { method: 'POST', body: JSON.stringify(data) }),
    bookFitnessClass: (tenantId: string, classId: string, memberId: string) =>
        json(`/gyms/${tenantId}/classes/${classId}/book`, { method: 'POST', body: JSON.stringify({ memberId }) }),
    checkInGymMember: (tenantId: string, memberId: string, data: Record<string, any> = {}) =>
        json(`/gyms/${tenantId}/members/${memberId}/check-in`, { method: 'POST', body: JSON.stringify(data) }),
    getEducationCourses: (tenantId: string) => json(`/education/${tenantId}/courses`),
    getEducationEnrollments: (tenantId: string) => json(`/education/${tenantId}/enrollments`),
    getEducationCohorts: (tenantId: string) => json(`/education/${tenantId}/cohorts`),
    createEducationEnrollment: (tenantId: string, data: Record<string, any>) =>
        json(`/education/${tenantId}/enrollments`, { method: 'POST', body: JSON.stringify(data) }),
    updateEducationEnrollment: (tenantId: string, enrollmentId: string, data: Record<string, any>) =>
        json(`/education/${tenantId}/enrollments/${enrollmentId}`, { method: 'PUT', body: JSON.stringify(data) }),
    cancelEducationCohort: (tenantId: string, cohortId: string) =>
        json(`/education/${tenantId}/cohorts/${cohortId}/cancel`, { method: 'POST', body: '{}' }),
    getInsurancePlans: (tenantId: string) => json(`/insurance/${tenantId}/plans`),
    getInsuranceQuotes: (tenantId: string) => json(`/insurance/${tenantId}/quotes`),
    getInsurancePolicies: (tenantId: string) => json(`/insurance/${tenantId}/policies`),
    getInsuranceClaims: (tenantId: string) => json(`/insurance/${tenantId}/claims`),
    createInsuranceQuote: (tenantId: string, data: Record<string, any>) =>
        json(`/insurance/${tenantId}/quotes`, { method: 'POST', body: JSON.stringify(data) }),
    updateInsuranceQuoteStatus: (tenantId: string, quoteId: string, status: string) =>
        json(`/insurance/${tenantId}/quotes/${quoteId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    createInsurancePolicy: (tenantId: string, data: Record<string, any>) =>
        json(`/insurance/${tenantId}/policies`, { method: 'POST', body: JSON.stringify(data) }),
    createInsuranceClaim: (tenantId: string, data: Record<string, any>) =>
        json(`/insurance/${tenantId}/claims`, { method: 'POST', body: JSON.stringify(data) }),
    getServiceRequests: (tenantId: string) => json(`/home-services/${tenantId}/requests`),
    getServiceRequest: (tenantId: string, requestId: string) =>
        json(`/home-services/${tenantId}/requests/${requestId}`),
    createServiceRequest: (tenantId: string, data: Record<string, any>) =>
        json(`/home-services/${tenantId}/requests`, { method: 'POST', body: JSON.stringify(data) }),
    updateServiceRequest: (tenantId: string, requestId: string, data: Record<string, any>) =>
        json(`/home-services/${tenantId}/requests/${requestId}`, { method: 'PUT', body: JSON.stringify(data) }),
    getPhotoSessions: (tenantId: string) => json(`/photography/${tenantId}/sessions`),
    getPhotoSession: (tenantId: string, sessionId: string) =>
        json(`/photography/${tenantId}/sessions/${sessionId}`),
    createPhotoSession: (tenantId: string, data: Record<string, any>) =>
        json(`/photography/${tenantId}/sessions`, { method: 'POST', body: JSON.stringify(data) }),
    updatePhotoSession: (tenantId: string, sessionId: string, data: Record<string, any>) =>
        json(`/photography/${tenantId}/sessions/${sessionId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deliverPhotoSession: (tenantId: string, sessionId: string, data: Record<string, any>) =>
        json(`/photography/${tenantId}/sessions/${sessionId}/deliver`, { method: 'PUT', body: JSON.stringify(data) }),
    getTestDrives: (tenantId: string) => json(`/vehicles/${tenantId}/test-drives/list`),
    createTestDrive: (tenantId: string, data: Record<string, any>) =>
        json(`/vehicles/${tenantId}/test-drives`, { method: 'POST', body: JSON.stringify(data) }),
    getResourceRentals: (tenantId: string, kind: string) =>
        json(`/resource-rentals/${tenantId}?type=${encodeURIComponent(kind)}`),
    createResourceRental: (tenantId: string, data: Record<string, any>) =>
        json(`/resource-rentals/${tenantId}`, { method: 'POST', body: JSON.stringify(data) }),
    updateResourceRentalStatus: (tenantId: string, rentalId: string, status: string) =>
        json(`/resource-rentals/${tenantId}/${rentalId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    // Appointment/operation selectors share the same paginated contract.
    getRealEstateListings: (tenantId: string) => json(`/listings/${tenantId}`),
    getPets: (tenantId: string, query: PagedQuery = {}) => {
        const params = pagedQueryString(query);
        return json(`/pets/${tenantId}/all${params ? `?${params}` : ''}`);
    },
    getVehicles: (tenantId: string, query: PagedQuery = {}) => {
        const params = pagedQueryString(query);
        return json(`/vehicles/${tenantId}${params ? `?${params}` : ''}`);
    },

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
    subscribeExpoPush: (token: string, installationId: string, signal?: AbortSignal) =>
        json('/push/expo-subscribe', { method: 'POST', body: JSON.stringify({ token, installationId }), signal }),
    unsubscribeExpoPush: (token?: string, signal?: AbortSignal) =>
        json('/push/expo-unsubscribe', { method: 'POST', body: JSON.stringify(token ? { token } : {}), signal }),

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

