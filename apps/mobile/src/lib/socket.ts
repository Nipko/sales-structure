import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from './config';
import { tokens, refreshAccessToken } from './api';
import { log } from './log';

// When a socket's auth is rejected (expired access token), refresh it once so the
// auto-reconnect picks up a fresh token. Debounced — connect_error fires on every
// retry. Without this, live updates silently stop until the next HTTP 401 refresh.
let refreshingSocketAuth = false;
function refreshSocketAuth() {
    if (refreshingSocketAuth) return;
    refreshingSocketAuth = true;
    refreshAccessToken().finally(() => {
        setTimeout(() => { refreshingSocketAuth = false; }, 4000);
    });
}

// Two namespaces, mirroring the dashboard backend:
//   /inbox  (ConversationsGateway)   → newMessage / conversationUpdated (auto-joins tenant room)
//   /agent  (AgentConsoleGateway)    → inbox:handoff / inbox:refresh / collision viewers (needs agent:join)
let inboxSocket: Socket | null = null;
let agentSocket: Socket | null = null;

// Auth as a CALLBACK so every (re)connection sends a FRESH access token. This is
// the key fix: a token that expired mid-session no longer breaks the socket forever.
const authCb = (cb: (data: any) => void) => {
    tokens.get().then(({ access }) => cb({ token: access })).catch(() => cb({}));
};

const OPTS = {
    transports: ['websocket', 'polling'] as string[],
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 8000,
    timeout: 12000,
};

// ── Connection status (so the UI can show ● LIVE / ○ offline) ──────────────
export type SocketStatus = 'connecting' | 'connected' | 'disconnected';
let inboxStatus: SocketStatus = 'disconnected';
const statusListeners = new Set<(s: SocketStatus) => void>();
function setInboxStatus(s: SocketStatus) {
    if (s === inboxStatus) return;
    inboxStatus = s;
    statusListeners.forEach((l) => l(s));
}
export function getInboxStatus(): SocketStatus { return inboxStatus; }
export function onInboxStatus(cb: (s: SocketStatus) => void): () => void {
    statusListeners.add(cb);
    cb(inboxStatus); // emit current immediately
    return () => { statusListeners.delete(cb); };
}

/** /inbox namespace — live messages. Auto-joins the tenant room from the JWT. */
export function getInboxSocket(): Socket {
    if (!inboxSocket) {
        setInboxStatus('connecting');
        inboxSocket = io(`${SOCKET_URL}/inbox`, { auth: authCb, ...OPTS });
        inboxSocket.on('connect', () => { log('[socket/inbox] connected', inboxSocket?.id); setInboxStatus('connected'); });
        inboxSocket.on('disconnect', (r) => {
            log('[socket/inbox] disconnect:', r);
            setInboxStatus('disconnected');
            // Server forced the disconnect (e.g. expired token) → socket.io won't
            // auto-reconnect. Refresh the token and reconnect manually.
            if (r === 'io server disconnect') { refreshSocketAuth(); setTimeout(() => inboxSocket?.connect(), 1500); }
        });
        inboxSocket.on('connect_error', (e) => { log('[socket/inbox] connect_error:', e?.message); setInboxStatus('disconnected'); refreshSocketAuth(); });
        inboxSocket.on('error', (e: any) => log('[socket/inbox] error:', e?.message || e));
    }
    return inboxSocket;
}

/** /agent namespace — handoff + collision. Must emit agent:join after each connect. */
export function getAgentSocket(): Socket {
    if (!agentSocket) {
        agentSocket = io(`${SOCKET_URL}/agent`, { auth: authCb, ...OPTS });
        // Rooms are per-socket → re-join on every (re)connect, not just the first.
        agentSocket.on('connect', async () => {
            log('[socket/agent] connected', agentSocket?.id);
            try {
                const u = await tokens.getUser();
                if (u?.tenantId) agentSocket!.emit('agent:join', { agentId: u.id, tenantId: u.tenantId });
            } catch { /* noop */ }
        });
        agentSocket.on('disconnect', (r) => {
            log('[socket/agent] disconnect:', r);
            if (r === 'io server disconnect') { refreshSocketAuth(); setTimeout(() => agentSocket?.connect(), 1500); }
        });
        agentSocket.on('connect_error', (e) => { log('[socket/agent] connect_error:', e?.message); refreshSocketAuth(); });
        agentSocket.on('error', (e: any) => log('[socket/agent] error:', e?.message || e));
    }
    return agentSocket;
}

/** Open both sockets eagerly (call right after login). Reconnects any that dropped. */
export function connectRealtime() {
    const i = getInboxSocket();
    const a = getAgentSocket();
    if (i.disconnected) i.connect();
    if (a.disconnected) a.connect();
}

/** Back-compat: existing screens await connectSocket() for the inbox namespace. */
export async function connectSocket(): Promise<Socket> { return getInboxSocket(); }

export function getSocket(): Socket | null { return inboxSocket; }

export function disconnectSocket() {
    inboxSocket?.disconnect();
    inboxSocket = null;
    agentSocket?.disconnect();
    agentSocket = null;
    refreshingSocketAuth = false; // clear so the next session can refresh auth
    setInboxStatus('disconnected');
}
