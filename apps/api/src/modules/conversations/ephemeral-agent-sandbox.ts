import { randomUUID } from 'node:crypto';

export const EPHEMERAL_AGENT_SANDBOX_VERSION = 1 as const;
export const EPHEMERAL_AGENT_SANDBOX_MAX_TTL_MS = 5 * 60_000;
export const EPHEMERAL_AGENT_SANDBOX_MAX_DEADLINE_MS = 60_000;

export type SandboxStubProvider = 'llm' | 'channel' | 'calendar' | 'payment' | 'email';

export interface EphemeralAgentSandboxRequest {
    tenantId: string;
    agentId: string;
    /** Lifetime of the isolated resources, independent from the run deadline. */
    ttlMs: number;
    /** Absolute upper bound for the scenario callback. */
    deadlineMs: number;
}

export interface EphemeralAgentSandboxLease {
    version: typeof EPHEMERAL_AGENT_SANDBOX_VERSION;
    sandboxId: string;
    expiresAt: string;
    resources: {
        databaseNamespace: string;
        redisNamespace: string;
        queueNamespace: string;
    };
    /** No live provider is legal in this product skeleton. */
    providers: Readonly<Record<SandboxStubProvider, 'stub'>>;
}

export interface EphemeralAgentSandboxProvisioner {
    provision(request: Readonly<EphemeralAgentSandboxRequest>): Promise<EphemeralAgentSandboxLease>;
    teardown(lease: Readonly<EphemeralAgentSandboxLease>): Promise<void>;
    listResidue(lease: Readonly<EphemeralAgentSandboxLease>): Promise<readonly string[]>;
}

export interface EphemeralAgentSandboxContext {
    lease: Readonly<EphemeralAgentSandboxLease>;
    signal: AbortSignal;
}

export class EphemeralSandboxContractError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EphemeralSandboxContractError';
    }
}

export class EphemeralSandboxTeardownError extends Error {
    constructor(
        message: string,
        readonly residue: readonly string[] = [],
        readonly runFailure?: unknown,
    ) {
        super(message);
        this.name = 'EphemeralSandboxTeardownError';
    }
}

function assertRequest(request: EphemeralAgentSandboxRequest): void {
    if (!request.tenantId?.trim() || !request.agentId?.trim()) {
        throw new EphemeralSandboxContractError('tenantId and agentId are required');
    }
    if (!Number.isInteger(request.ttlMs) || request.ttlMs < 1 || request.ttlMs > EPHEMERAL_AGENT_SANDBOX_MAX_TTL_MS) {
        throw new EphemeralSandboxContractError('sandbox ttl is outside the permitted range');
    }
    if (!Number.isInteger(request.deadlineMs)
        || request.deadlineMs < 1
        || request.deadlineMs > EPHEMERAL_AGENT_SANDBOX_MAX_DEADLINE_MS
        || request.deadlineMs > request.ttlMs) {
        throw new EphemeralSandboxContractError('sandbox deadline is outside the permitted range');
    }
}

function assertLease(lease: EphemeralAgentSandboxLease, request: EphemeralAgentSandboxRequest, now: number): void {
    if (lease.version !== EPHEMERAL_AGENT_SANDBOX_VERSION || !lease.sandboxId?.trim()) {
        throw new EphemeralSandboxContractError('provisioner returned an invalid sandbox lease');
    }
    const expiry = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now || expiry > now + request.ttlMs + 1_000) {
        throw new EphemeralSandboxContractError('sandbox lease expiry is invalid');
    }
    for (const provider of ['llm', 'channel', 'calendar', 'payment', 'email'] as const) {
        if (lease.providers?.[provider] !== 'stub') {
            throw new EphemeralSandboxContractError(`live provider is forbidden in sandbox: ${provider}`);
        }
    }
    const namespaces = Object.values(lease.resources || {});
    if (namespaces.length !== 3
        || namespaces.some((namespace) => typeof namespace !== 'string' || !namespace.includes(lease.sandboxId))) {
        throw new EphemeralSandboxContractError('sandbox resources are not uniquely namespaced');
    }
}

/**
 * Separate product skeleton for destructive/writer simulations. It is not an
 * Agent Test mode and deliberately exposes no production provider switch.
 */
export class EphemeralAgentSandboxRunner {
    constructor(
        private readonly provisioner: EphemeralAgentSandboxProvisioner,
        private readonly now: () => number = Date.now,
    ) {}

    async run<T>(
        request: EphemeralAgentSandboxRequest,
        scenario: (context: EphemeralAgentSandboxContext) => Promise<T>,
    ): Promise<T> {
        assertRequest(request);
        const lease = await this.provisioner.provision(Object.freeze({ ...request }));
        let runFailure: unknown;
        let result: T | undefined;
        let teardownFailure: unknown;
        let residue: readonly string[] = [];

        try {
            assertLease(lease, request, this.now());
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort(new Error('sandbox deadline exceeded'));
                    reject(new EphemeralSandboxContractError('sandbox deadline exceeded'));
                }, request.deadlineMs);
                timer.unref?.();
            });
            try {
                result = await Promise.race([
                    scenario({ lease: Object.freeze(lease), signal: controller.signal }),
                    deadline,
                ]);
            } finally {
                if (timer) clearTimeout(timer);
                controller.abort(new Error('sandbox run completed'));
            }
        } catch (error) {
            runFailure = error;
        } finally {
            try {
                await this.provisioner.teardown(lease);
            } catch (error) {
                teardownFailure = error;
            }
            try {
                residue = await this.provisioner.listResidue(lease);
            } catch (error) {
                teardownFailure ||= error;
                residue = ['teardown_verification_unavailable'];
            }
        }

        if (teardownFailure || residue.length > 0) {
            throw new EphemeralSandboxTeardownError(
                teardownFailure ? 'sandbox teardown could not be verified' : 'sandbox teardown left resources behind',
                residue,
                runFailure,
            );
        }
        if (runFailure) throw runFailure;
        return result as T;
    }
}

/**
 * Zero-I/O provisioner used until real isolated DB/Redis/queue adapters exist.
 * It lets API/CI exercise lifecycle semantics without touching DB, Redis, queues
 * or provider networks.
 */
export class StubEphemeralSandboxProvisioner implements EphemeralAgentSandboxProvisioner {
    private readonly active = new Set<string>();

    constructor(private readonly now: () => number = Date.now) {}

    async provision(request: Readonly<EphemeralAgentSandboxRequest>): Promise<EphemeralAgentSandboxLease> {
        const sandboxId = randomUUID();
        this.active.add(sandboxId);
        return {
            version: EPHEMERAL_AGENT_SANDBOX_VERSION,
            sandboxId,
            expiresAt: new Date(this.now() + request.ttlMs).toISOString(),
            resources: {
                databaseNamespace: `stub_db_${sandboxId}`,
                redisNamespace: `stub_redis:${sandboxId}:`,
                queueNamespace: `stub_queue:${sandboxId}:`,
            },
            providers: {
                llm: 'stub', channel: 'stub', calendar: 'stub', payment: 'stub', email: 'stub',
            },
        };
    }

    async teardown(lease: Readonly<EphemeralAgentSandboxLease>): Promise<void> {
        this.active.delete(lease.sandboxId);
    }

    async listResidue(lease: Readonly<EphemeralAgentSandboxLease>): Promise<readonly string[]> {
        return this.active.has(lease.sandboxId) ? [`stub:${lease.sandboxId}`] : [];
    }
}
