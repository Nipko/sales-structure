import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import {
    EPHEMERAL_AGENT_SANDBOX_VERSION,
    EphemeralAgentSandboxRunner,
    EphemeralSandboxContractError,
    EphemeralSandboxTeardownError,
    StubEphemeralSandboxProvisioner,
} from './ephemeral-agent-sandbox';

const REQUEST = {
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    ttlMs: 1_000,
    deadlineMs: 100,
};

describe('EphemeralAgentSandboxRunner contract', () => {
    it('keeps Agent Test as a separate persistence-disabled preview', () => {
        expect(AGENT_TEST_EXECUTION_CONTEXT).toEqual({
            mode: 'agent_test',
            persistence: 'disabled',
            operationalUsageAccounting: 'enabled',
        });
        expect(Object.isFrozen(AGENT_TEST_EXECUTION_CONTEXT)).toBe(true);
    });

    it('uses only stub providers and verifies teardown after success', async () => {
        const provisioner = new StubEphemeralSandboxProvisioner(() => 1_000);
        const runner = new EphemeralAgentSandboxRunner(provisioner, () => 1_000);

        const value = await runner.run(REQUEST, async ({ lease, signal }) => {
            expect(lease.version).toBe(EPHEMERAL_AGENT_SANDBOX_VERSION);
            expect(new Set(Object.values(lease.providers))).toEqual(new Set(['stub']));
            expect(signal.aborted).toBe(false);
            return 'ok';
        });

        expect(value).toBe('ok');
    });

    it('tears down and rethrows when the scenario fails', async () => {
        const provisioner = new StubEphemeralSandboxProvisioner();
        const teardown = jest.spyOn(provisioner, 'teardown');
        const runner = new EphemeralAgentSandboxRunner(provisioner);

        await expect(runner.run(REQUEST, async () => {
            throw new Error('scenario failed');
        })).rejects.toThrow('scenario failed');
        expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('fails closed when teardown leaves any residue', async () => {
        const base = new StubEphemeralSandboxProvisioner();
        const provisioner = {
            provision: base.provision.bind(base),
            teardown: jest.fn().mockResolvedValue(undefined),
            listResidue: jest.fn().mockResolvedValue(['redis:sandbox:leak']),
        };
        const runner = new EphemeralAgentSandboxRunner(provisioner);

        await expect(runner.run(REQUEST, async () => 'unsafe'))
            .rejects.toBeInstanceOf(EphemeralSandboxTeardownError);
    });

    it('enforces an absolute deadline even when the scenario ignores AbortSignal', async () => {
        const runner = new EphemeralAgentSandboxRunner(new StubEphemeralSandboxProvisioner());
        await expect(runner.run(
            { ...REQUEST, deadlineMs: 5 },
            async () => new Promise<string>(() => undefined),
        )).rejects.toBeInstanceOf(EphemeralSandboxContractError);
    });
});
