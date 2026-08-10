import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { onInboxStatus } from './socket';

const LEGACY_STORAGE_KEY = 'parallly_outbox_v1';
const STORAGE_PREFIX = 'parallly_outbox_v2:';

/**
 * Outbound message queue (GATE 0 — resiliencia offline).
 *
 * The queue is activated only after AuthContext restores/authenticates a user and
 * is stored under that exact user + tenant. This is a security boundary: a
 * persisted message from one account must never be rendered or retried with the
 * credentials of the next account that uses the device.
 */
export interface OutboxItem {
    id: string;
    tenantId: string;
    conversationId: string;
    body: string;
    agentId?: string;
    failed?: boolean;
}

interface OutboxScope {
    userId: string;
    tenantId: string;
    storageKey: string;
}

let activeScope: OutboxScope | null = null;
let queue: OutboxItem[] = [];
const subscribers = new Set<() => void>();
let flushing = false;
let scopeGeneration = 0;
let storageWrites: Promise<void> = Promise.resolve();

function storageKey(userId: string, tenantId: string): string {
    return `${STORAGE_PREFIX}${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}`;
}

function sameScope(scope: OutboxScope | null, userId: string, tenantId: string): boolean {
    return !!scope && scope.userId === userId && scope.tenantId === tenantId;
}

function notifySubscribers(): void {
    subscribers.forEach((fn) => fn());
}

function persist(): void {
    const scope = activeScope;
    const generation = scopeGeneration;
    if (!scope) return;
    const serialized = JSON.stringify(queue);
    // Serialize writes so logout can wait for every prior setItem before removing
    // keys. Otherwise a slow setItem could recreate sensitive data after cleanup.
    storageWrites = storageWrites
        .catch(() => {})
        .then(async () => {
            if (generation !== scopeGeneration || activeScope?.storageKey !== scope.storageKey) return;
            await AsyncStorage.setItem(scope.storageKey, serialized);
        })
        .catch(() => {});
}

function notify(): void {
    notifySubscribers();
    persist();
}

function isValidForScope(item: OutboxItem, scope: OutboxScope): boolean {
    return !!item
        && typeof item.id === 'string'
        && typeof item.conversationId === 'string'
        && typeof item.body === 'string'
        && item.tenantId === scope.tenantId
        && item.agentId === scope.userId;
}

/** Activate and hydrate only this authenticated user's queue. */
export async function activateOutboxScope(userId: string, tenantId: string): Promise<void> {
    if (!userId || !tenantId) {
        deactivateOutboxScope();
        return;
    }
    if (sameScope(activeScope, userId, tenantId)) return;

    const generation = ++scopeGeneration;
    const scope: OutboxScope = { userId, tenantId, storageKey: storageKey(userId, tenantId) };
    activeScope = scope;
    queue = [];
    notifySubscribers();

    await storageWrites.catch(() => {});
    // v1 had no user boundary. It is unsafe to infer its owner, so migrate by
    // deleting it rather than ever displaying or sending it under a new session.
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
    const raw = await AsyncStorage.getItem(scope.storageKey).catch(() => null);
    if (generation !== scopeGeneration || activeScope?.storageKey !== scope.storageKey) return;

    if (raw) {
        try {
            const saved = JSON.parse(raw) as OutboxItem[];
            if (Array.isArray(saved)) {
                queue = saved
                    .filter((item) => isValidForScope(item, scope))
                    .map((item) => ({ ...item, failed: false }));
            }
        } catch {
            queue = [];
        }
    }
    notify(); // also rewrites malformed/cross-scope rows out of this key
    if (queue.length) void flush();
}

/** Immediately makes the in-memory queue unavailable to retries/rendering. */
export function deactivateOutboxScope(): void {
    scopeGeneration++;
    activeScope = null;
    queue = [];
    notifySubscribers();
}

/**
 * Logout/privacy cleanup: clear every outbox generation on the device, including
 * legacy and queues left by an interrupted prior logout.
 */
export async function clearAllOutboxStorage(): Promise<void> {
    deactivateOutboxScope();
    await storageWrites.catch(() => {});
    try {
        const keys = await AsyncStorage.getAllKeys();
        const outboxKeys = keys.filter((key) => key === LEGACY_STORAGE_KEY || key.startsWith(STORAGE_PREFIX));
        if (outboxKeys.length) await AsyncStorage.multiRemove(outboxKeys);
    } catch {
        // Local cleanup is best-effort; the queue is already deactivated in memory.
    }
}

/** Subscribe to queue changes (enqueue / sent / failed / account switch). */
export function subscribeOutbox(fn: () => void): () => void {
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
}

/** Pending items for the active account and a given conversation, in order. */
export function pendingFor(conversationId: string): OutboxItem[] {
    if (!activeScope) return [];
    return queue.filter((q) => q.conversationId === conversationId && isValidForScope(q, activeScope!));
}

/** Queue a message only when it belongs to the active user + tenant. */
export function enqueue(item: OutboxItem): boolean {
    const scope = activeScope;
    if (!scope || item.tenantId !== scope.tenantId) return false;
    if (item.agentId && item.agentId !== scope.userId) return false;
    queue.push({ ...item, agentId: scope.userId, failed: false });
    notify();
    void flush();
    return true;
}

/** Manually retry failed items (e.g. the agent taps a failed bubble). */
export function retry(id?: string): void {
    if (!activeScope) return;
    queue.forEach((q) => { if (!id || q.id === id) q.failed = false; });
    notify();
    void flush();
}

/** Attempt to send the active account's queued messages in order. */
export async function flush(): Promise<void> {
    if (flushing || !activeScope) return;
    flushing = true;
    const generation = scopeGeneration;
    const scope = activeScope;
    try {
        for (const item of [...queue]) {
            if (generation !== scopeGeneration || activeScope?.storageKey !== scope.storageKey) return;
            if (!isValidForScope(item, scope)) {
                queue = queue.filter((q) => q.id !== item.id);
                notify();
                continue;
            }
            try {
                const result = await api.sendMessage(item.tenantId, item.conversationId, item.body, scope.userId);
                if (!result?.success) throw new Error(result?.error || 'send_failed');
                if (generation !== scopeGeneration || activeScope?.storageKey !== scope.storageKey) return;
                queue = queue.filter((q) => q.id !== item.id);
                notify();
            } catch {
                if (generation !== scopeGeneration || activeScope?.storageKey !== scope.storageKey) return;
                const queued = queue.find((q) => q.id === item.id);
                if (queued) queued.failed = true;
                notify();
                break;
            }
        }
    } finally {
        flushing = false;
        // If an account changed while an old request was in flight, allow the new
        // scope to start its own flush after the old one releases the lock.
        if (generation !== scopeGeneration && activeScope && queue.length) void flush();
    }
}

// Reconnects may retry only after AuthContext has activated an authenticated scope.
onInboxStatus((status) => { if (status === 'connected' && activeScope) void flush(); });
