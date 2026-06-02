import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from './config';
import { tokens } from './api';

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
        inboxSocket.on('connect', () => { console.log('[socket/inbox] connected', inboxSocket?.id); setInboxStatus('connected'); });
        inboxSocket.on('disconnect', (r) => { console.log('[socket/inbox] disconnect:', r); setInboxStatus('disconnected'); });
        inboxSocket.on('connect_error', (e) => { console.log('[socket/inbox] connect_error:', e?.message); setInboxStatus('disconnected'); });
        inboxSocket.on('error', (e: any) => console.log('[socket/inbox] error:', e?.message || e));
    }
    return inboxSocket;
}

/** /agent namespace — handoff + collision. Must emit agent:join after each connect. */
export function getAgentSocket(): Socket {
    if (!agentSocket) {
        agentSocket = io(`${SOCKET_URL}/agent`, { auth: authCb, ...OPTS });
        // Rooms are per-socket → re-join on every (re)connect, not just the first.
        agentSocket.on('connect', async () => {
            console.log('[socket/agent] connected', agentSocket?.id);
            try {
                const u = await tokens.getUser();
                if (u?.tenantId) agentSocket!.emit('agent:join', { agentId: u.id, tenantId: u.tenantId });
            } catch { /* noop */ }
        });
        agentSocket.on('disconnect', (r) => console.log('[socket/agent] disconnect:', r));
        agentSocket.on('connect_error', (e) => console.log('[socket/agent] connect_error:', e?.message));
        agentSocket.on('error', (e: any) => console.log('[socket/agent] error:', e?.message || e));
    }
    return agentSocket;
}

/** Open both sockets eagerly (call right after login). */
export function connectRealtime() {
    getInboxSocket();
    getAgentSocket();
}

/** Back-compat: existing screens await connectSocket() for the inbox namespace. */
export async function connectSocket(): Promise<Socket> { return getInboxSocket(); }

export function getSocket(): Socket | null { return inboxSocket; }

export function disconnectSocket() {
    inboxSocket?.disconnect();
    inboxSocket = null;
    agentSocket?.disconnect();
    agentSocket = null;
    setInboxStatus('disconnected');
}
