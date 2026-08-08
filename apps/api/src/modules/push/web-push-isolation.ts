import { BadRequestException } from '@nestjs/common';
import { join } from 'node:path';
import { Worker, type ResourceLimits, type WorkerOptions } from 'node:worker_threads';

export const WEB_PUSH_ABSOLUTE_DEADLINE_MS = 10_000;
export const WEB_PUSH_MAX_PAYLOAD_BYTES = 4 * 1024;
export const WEB_PUSH_MAX_RESPONSE_BYTES = 16 * 1024;
export const WEB_PUSH_MAX_SUBSCRIPTIONS_PER_DISPATCH = 100;
export const EXPO_PUSH_MAX_REQUEST_BYTES = 256 * 1024;
export const EXPO_PUSH_MAX_RESPONSE_BYTES = 64 * 1024;
export const WEB_PUSH_WORKER_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
    maxOldGenerationSizeMb: 64,
    maxYoungGenerationSizeMb: 16,
    stackSizeMb: 4,
});

const EXACT_PUSH_SERVICE_HOSTS = new Set([
    'fcm.googleapis.com',
    'android.googleapis.com',
    'web.push.apple.com',
]);
const PUSH_SERVICE_SUFFIXES = [
    '.push.services.mozilla.com',
    '.notify.windows.com',
] as const;

export function isAllowlistedPushServiceHostname(rawHostname: string): boolean {
    const hostname = String(rawHostname || '').toLowerCase().replace(/\.$/, '');
    return EXACT_PUSH_SERVICE_HOSTS.has(hostname)
        || PUSH_SERVICE_SUFFIXES.some((suffix) => hostname.endsWith(suffix)
            && hostname.length > suffix.length);
}

export function assertAllowlistedPushServiceHostname(hostname: string): void {
    if (!isAllowlistedPushServiceHostname(hostname)) {
        throw new BadRequestException('Servicio Web Push no permitido');
    }
}

export function assertBoundedWebPushPayload(payload: string): void {
    if (Buffer.byteLength(payload, 'utf8') > WEB_PUSH_MAX_PAYLOAD_BYTES) {
        throw new BadRequestException('Payload Web Push excede el limite permitido');
    }
}

export function assertBoundedWebPushResponse(body: unknown): void {
    const bytes = Buffer.byteLength(typeof body === 'string' ? body : '', 'utf8');
    if (bytes > WEB_PUSH_MAX_RESPONSE_BYTES) {
        throw new Error('Web Push response exceeded memory cap');
    }
}

export async function withPushAbsoluteDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    deadlineMs = WEB_PUSH_ABSOLUTE_DEADLINE_MS,
): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const error = Object.assign(new Error('Push provider absolute deadline exceeded'), {
                code: 'PUSH_PROVIDER_DEADLINE',
            });
            controller.abort(error);
            reject(error);
        }, deadlineMs);
        timer.unref?.();
    });
    try {
        return await Promise.race([operation(controller.signal), deadline]);
    } finally {
        if (timer) clearTimeout(timer);
        controller.abort(new Error('Push provider operation completed'));
    }
}

/** Incremental response reader: a drip cannot bypass the outer deadline and a
 * large provider response is cancelled before it is assembled into a string. */
export async function readBoundedPushJsonResponse(
    response: any,
    maxBytes = EXPO_PUSH_MAX_RESPONSE_BYTES,
): Promise<any> {
    const declaredLength = Number(response?.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error('Push provider response exceeded memory cap');
    }
    const reader = response?.body?.getReader?.();
    if (!reader) return {};

    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    while (true) {
        const chunk = await reader.read();
        if (chunk?.done) break;
        const value: Uint8Array = chunk?.value instanceof Uint8Array
            ? chunk.value : new Uint8Array(chunk?.value || []);
        bytes += value.byteLength;
        if (bytes > maxBytes) {
            try {
                await reader.cancel?.('response_size_cap');
            } catch {
                // The size violation remains authoritative even if cancel fails.
            }
            throw new Error('Push provider response exceeded memory cap');
        }
        text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (!text.trim()) return {};
    return JSON.parse(text);
}

export interface IsolatedWebPushRequest {
    endpoint: string;
    hostname: string;
    address: string;
    family: 4 | 6;
    keys: { p256dh: string; auth: string };
    payload: string;
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
}

interface WorkerLike {
    once(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): this;
    removeAllListeners(): this;
    terminate(): Promise<number>;
}

export type WebPushWorkerFactory = (
    filename: string,
    options: WorkerOptions,
) => WorkerLike;

export class IsolatedWebPushExecutor {
    constructor(
        private readonly workerFactory: WebPushWorkerFactory = (filename, options) => new Worker(filename, options),
        private readonly workerFilename = join(__dirname, 'web-push.worker.js'),
    ) {}

    async send(request: IsolatedWebPushRequest): Promise<void> {
        assertAllowlistedPushServiceHostname(request.hostname);
        assertBoundedWebPushPayload(request.payload);

        const worker = this.workerFactory(this.workerFilename, {
            workerData: {
                ...request,
                deadlineMs: WEB_PUSH_ABSOLUTE_DEADLINE_MS,
                maxResponseBytes: WEB_PUSH_MAX_RESPONSE_BYTES,
            },
            resourceLimits: { ...WEB_PUSH_WORKER_RESOURCE_LIMITS },
        });

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                worker.removeAllListeners();
                void worker.terminate().catch(() => undefined);
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            };
            const timer = setTimeout(() => {
                finish(Object.assign(new Error('Web Push absolute deadline exceeded'), {
                    code: 'WEB_PUSH_DEADLINE',
                }));
            }, WEB_PUSH_ABSOLUTE_DEADLINE_MS);
            timer.unref?.();

            worker.once('message', (message: any) => {
                if (message?.ok === true) {
                    finish();
                    return;
                }
                const error = Object.assign(
                    new Error(String(message?.message || 'Web Push worker failed').slice(0, 512)),
                    { statusCode: message?.statusCode },
                );
                finish(error);
            });
            worker.once('error', (error: Error) => finish(error));
            worker.once('exit', (code: number) => {
                finish(new Error(`Web Push worker exited before a verified response (code ${code})`));
            });
        });
    }
}
