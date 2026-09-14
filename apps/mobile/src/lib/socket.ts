import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from './config';
import { tokens, refreshAccessToken } from './api';
import { log } from './log';

let inboxSocket: Socket | null = null;
let agentSocket: Socket | null = null;
let sessionGeneration = 0;
let refreshingSocketAuth: Promise<void> | null = null;
const reconnectTimers = new Set<ReturnType<typeof setTimeout>>();
let agentReady = false;
const agentReadyListeners = new Set<() => void>();

function isCurrent(socket: Socket, generation: number): boolean {
    return generation === sessionGeneration && (socket === inboxSocket || socket === agentSocket);
}

// Read a fresh token on every connection; a logged-out session cannot reuse it.
const authFor = (generation: number) => (cb: (data: any) => void) => {
    tokens.get().then(({ access }) => cb(generation === sessionGeneration ? { token: access } : {}))
        .catch(() => cb({}));
};

function refreshSocketAuth(): Promise<void> {
    if (refreshingSocketAuth) return refreshingSocketAuth;
    const generation = sessionGeneration;
    const refresh = refreshAccessToken().then(() => {}, () => {});
    refreshingSocketAuth = refresh;
    void refresh.then(() => {
        if (generation === sessionGeneration && refreshingSocketAuth === refresh) refreshingSocketAuth = null;
    });
    return refresh;
}

// Server-forced disconnects do not auto-reconnect. Wait for refresh, and guard
// delayed callbacks so logout cannot reconnect a socket from the old session.
function reconnectAfterRefresh(socket: Socket, generation: number): void {
    void refreshSocketAuth().then(() => {
        if (!isCurrent(socket, generation)) return;
        const timer = setTimeout(() => {
            reconnectTimers.delete(timer);
            if (isCurrent(socket, generation) && socket.disconnected) socket.connect();
        }, 1500);
        reconnectTimers.add(timer);
    });
}

const OPTS = {
    transports: ['websocket', 'polling'] as string[],
    reconnection: true,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 8000,
    timeout: 12000,
};

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
    cb(inboxStatus);
    return () => { statusListeners.delete(cb); };
}

/** The initial inbox:update confirms agent:join completed on this connection. */
export function onAgentReady(cb: () => void): () => void {
    agentReadyListeners.add(cb);
    if (agentReady && agentSocket?.connected) cb();
    return () => { agentReadyListeners.delete(cb); };
}

/** /inbox — tenant room is joined from the verified JWT. */
export function getInboxSocket(): Socket {
    if (!inboxSocket) {
        const generation = sessionGeneration;
        setInboxStatus('connecting');
        const socket = io(SOCKET_URL + '/inbox', { auth: authFor(generation), ...OPTS });
        inboxSocket = socket;
        socket.on('connect', () => {
            if (!isCurrent(socket, generation)) return;
            log('[socket/inbox] connected', socket.id);
            setInboxStatus('connected');
        });
        socket.on('disconnect', (reason) => {
            if (!isCurrent(socket, generation)) return;
            setInboxStatus('disconnected');
            if (reason === 'io server disconnect') reconnectAfterRefresh(socket, generation);
        });
        socket.on('connect_error', () => {
            if (!isCurrent(socket, generation)) return;
            setInboxStatus('disconnected');
            void refreshSocketAuth();
        });
        socket.on('error', (e: any) => log('[socket/inbox] error:', e?.message || e));
    }
    return inboxSocket;
}

/** /agent — agent:join and presence must be restored after each reconnect. */
export function getAgentSocket(): Socket {
    if (!agentSocket) {
        const generation = sessionGeneration;
        const socket = io(SOCKET_URL + '/agent', { auth: authFor(generation), ...OPTS });
        agentSocket = socket;
        socket.on('connect', async () => {
            if (!isCurrent(socket, generation)) return;
            agentReady = false;
            const connectionId = socket.id;
            try {
                const user = await tokens.getUser();
                if (isCurrent(socket, generation) && socket.connected && socket.id === connectionId && user?.tenantId) {
                    socket.emit('agent:join', { agentId: user.id, tenantId: user.tenantId });
                }
            } catch { /* A failed local session read cannot join a tenant room. */ }
        });
        socket.on('inbox:update', () => {
            if (!isCurrent(socket, generation) || !socket.connected || agentReady) return;
            agentReady = true;
            agentReadyListeners.forEach((listener) => listener());
        });
        socket.on('disconnect', (reason) => {
            if (!isCurrent(socket, generation)) return;
            agentReady = false;
            if (reason === 'io server disconnect') reconnectAfterRefresh(socket, generation);
        });
        socket.on('connect_error', () => {
            if (isCurrent(socket, generation)) void refreshSocketAuth();
        });
        socket.on('error', (e: any) => log('[socket/agent] error:', e?.message || e));
    }
    return agentSocket;
}

export function connectRealtime() {
    const inbox = getInboxSocket();
    const agent = getAgentSocket();
    if (inbox.disconnected) inbox.connect();
    if (agent.disconnected) agent.connect();
}
export async function connectSocket(): Promise<Socket> { return getInboxSocket(); }
export function getSocket(): Socket | null { return inboxSocket; }

export function disconnectSocket() {
    sessionGeneration++;
    reconnectTimers.forEach(clearTimeout);
    reconnectTimers.clear();
    refreshingSocketAuth = null;
    agentReady = false;
    agentReadyListeners.clear();
    const inbox = inboxSocket;
    const agent = agentSocket;
    inboxSocket = null;
    agentSocket = null;
    inbox?.disconnect();
    agent?.disconnect();
    setInboxStatus('disconnected');
}
