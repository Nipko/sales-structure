import { Agent as HttpsAgent } from 'node:https';
import type { LookupFunction } from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';
import * as webpush from 'web-push';
import {
    assertAllowlistedPushServiceHostname,
    assertBoundedWebPushPayload,
    assertBoundedWebPushResponse,
    type IsolatedWebPushRequest,
} from './web-push-isolation';

interface WorkerRequest extends IsolatedWebPushRequest {
    deadlineMs: number;
    maxResponseBytes: number;
}

async function run(request: WorkerRequest): Promise<void> {
    assertAllowlistedPushServiceHostname(request.hostname);
    assertBoundedWebPushPayload(request.payload);
    const endpoint = new URL(request.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.hostname.toLowerCase() !== request.hostname.toLowerCase()) {
        throw new Error('Pinned Web Push endpoint mismatch');
    }

    const lookup: LookupFunction = (hostname, options, callback) => {
        if (hostname.toLowerCase().replace(/\.$/, '') !== request.hostname.toLowerCase().replace(/\.$/, '')) {
            callback(Object.assign(new Error('Web Push destination changed'), { code: 'EAI_FAIL' }), '', 0);
            return;
        }
        if (options?.all) {
            callback(null, [{ address: request.address, family: request.family }]);
            return;
        }
        callback(null, request.address, request.family);
    };
    const agent = new HttpsAgent({ keepAlive: false, lookup });
    try {
        const result = await webpush.sendNotification(
            { endpoint: request.endpoint, keys: request.keys },
            request.payload,
            {
                agent,
                timeout: request.deadlineMs,
                vapidDetails: request.vapidDetails,
            },
        );
        assertBoundedWebPushResponse(result.body);
        parentPort?.postMessage({ ok: true, statusCode: result.statusCode });
    } finally {
        agent.destroy();
    }
}

void run(workerData as WorkerRequest).catch((error: any) => {
    parentPort?.postMessage({
        ok: false,
        statusCode: typeof error?.statusCode === 'number' ? error.statusCode : undefined,
        message: String(error?.message || 'Web Push worker failed').slice(0, 512),
    });
});
