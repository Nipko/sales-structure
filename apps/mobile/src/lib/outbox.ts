import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { onInboxStatus } from './socket';

const STORAGE_KEY = 'parallly_outbox_v1';

/**
 * Outbound message queue (GATE 0 — resiliencia offline).
 * If a send fails (network/socket down) the message is kept here and retried
 * automatically when the inbox socket reconnects, so nothing is lost on flaky
 * LatAm connectivity. In-memory for now (survives nav, not app kill — persistence
 * via AsyncStorage is a follow-up).
 */
export interface OutboxItem {
    id: string;
    tenantId: string;
    conversationId: string;
    body: string;
    agentId?: string;
    failed?: boolean;
}

let queue: OutboxItem[] = [];
const subscribers = new Set<() => void>();
let flushing = false;

function persist() { AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue)).catch(() => {}); }
function notify() { subscribers.forEach((fn) => fn()); persist(); }

/** Subscribe to queue changes (enqueue / sent / failed). Returns an unsubscribe fn. */
export function subscribeOutbox(fn: () => void): () => void {
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
}

/** Pending (not-yet-sent) items for a given conversation, in order. */
export function pendingFor(conversationId: string): OutboxItem[] {
    return queue.filter((q) => q.conversationId === conversationId);
}

/** Queue a message and try to flush immediately. */
export function enqueue(item: OutboxItem): void {
    queue.push({ ...item, failed: false });
    notify();
    void flush();
}

/** Attempt to send all queued messages in order. Stops at the first failure. */
export async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
        for (const item of [...queue]) {
            try {
                await api.sendMessage(item.tenantId, item.conversationId, item.body, item.agentId);
                queue = queue.filter((q) => q.id !== item.id);
                notify();
            } catch {
                // Mark failed and stop — likely offline; a reconnect will retry.
                const q = queue.find((x) => x.id === item.id);
                if (q) q.failed = true;
                notify();
                break;
            }
        }
    } finally {
        flushing = false;
    }
}

// Auto-retry the queue whenever the realtime connection comes back.
onInboxStatus((status) => { if (status === 'connected') void flush(); });

// Hydrate any queue persisted from a previous app run (survives app kill), then try to send.
AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as OutboxItem[];
        if (Array.isArray(saved) && saved.length) {
            // mark restored items as not-failed so the UI shows them as pending again
            queue = saved.map((q) => ({ ...q, failed: false }));
            subscribers.forEach((fn) => fn());
            void flush();
        }
    })
    .catch(() => {});
