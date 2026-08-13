import {
    AGENT_EVAL_COMPLETED_EVENT,
    AGENT_EVAL_FAILED_EVENT,
    EvalService,
} from './eval.service';
import {
    AGENT_SIMULATION_COMPLETED_EVENT,
    AGENT_SIMULATION_FAILED_EVENT,
    SimulationService,
} from './simulation.service';

describe('agent quality completion events', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const agentId = '22222222-2222-4222-8222-222222222222';
    const runId = '33333333-3333-4333-8333-333333333333';

    describe('EvalService', () => {
        function makeService() {
            const redis = {
                acquireLock: jest.fn().mockResolvedValue(true),
                releaseLock: jest.fn().mockResolvedValue(undefined),
            };
            const eventEmitter = { emit: jest.fn() };
            const quality = { judgeTranscript: jest.fn() };
            const agentTest = { test: jest.fn() };
            const service = new EvalService(
                { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_eval') } as any,
                quality as any,
                agentTest as any,
                redis as any,
                eventEmitter as any,
            );
            return { service, redis, eventEmitter, quality, agentTest };
        }

        it('emits completion after a basic eval finishes', async () => {
            const { service, eventEmitter } = makeService();
            jest.spyOn(service, 'listScenarios').mockResolvedValue([]);

            await expect(service.runGate(tenantId, agentId)).resolves.toMatchObject({ passed: true, total: 0 });

            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_EVAL_COMPLETED_EVENT, {
                tenantId,
                agentId,
                runId: null,
                status: 'completed',
            });
        });

        it('emits completion after the persisted v2 eval path finishes', async () => {
            const { service, eventEmitter } = makeService();
            jest.spyOn(service as any, 'ensureTable').mockResolvedValue(undefined);
            jest.spyOn(service as any, 'ensureSandboxContact').mockResolvedValue(undefined);
            jest.spyOn(service, 'listScenarios').mockResolvedValue([]);
            jest.spyOn(service as any, 'persistRun').mockResolvedValue(undefined);

            await expect(service.runGateV2(tenantId, agentId)).resolves.toMatchObject({ total: 0 });

            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_EVAL_COMPLETED_EVENT, {
                tenantId,
                agentId,
                runId: null,
                status: 'completed',
            });
        });

        it('emits failure and preserves a basic eval error', async () => {
            const { service, eventEmitter } = makeService();
            jest.spyOn(service, 'listScenarios').mockRejectedValue(new Error('scenario storage unavailable'));

            await expect(service.runGate(tenantId, agentId)).rejects.toThrow('scenario storage unavailable');
            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_EVAL_FAILED_EVENT, {
                tenantId,
                agentId,
                runId: null,
                status: 'failed',
            });
        });

        it('fails a judge error instead of turning it into a zero-score successful eval', async () => {
            const { service, eventEmitter } = makeService();
            jest.spyOn(service, 'listScenarios').mockResolvedValue([{ key: 'judge', title: 'Judge' }] as any);
            jest.spyOn(service as any, 'runScenario').mockRejectedValue(new Error('judge unavailable'));

            await expect(service.runGate(tenantId, agentId)).rejects.toThrow('judge unavailable');
            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_EVAL_FAILED_EVENT, {
                tenantId,
                agentId,
                runId: null,
                status: 'failed',
            });
            expect(eventEmitter.emit).not.toHaveBeenCalledWith(
                AGENT_EVAL_COMPLETED_EVENT,
                expect.anything(),
            );
        });

        it('does not persist a successful v2 eval when a scenario is unscorable', async () => {
            const { service, eventEmitter } = makeService();
            jest.spyOn(service as any, 'ensureTable').mockResolvedValue(undefined);
            jest.spyOn(service as any, 'ensureSandboxContact').mockResolvedValue(undefined);
            jest.spyOn(service, 'listScenarios').mockResolvedValue([{ key: 'judge', title: 'Judge' }] as any);
            jest.spyOn(service as any, 'runPassK').mockRejectedValue(new Error('judge unavailable'));
            const persist = jest.spyOn(service as any, 'persistRun').mockResolvedValue(undefined);

            await expect(service.runGateV2(tenantId, agentId)).rejects.toThrow('judge unavailable');
            expect(persist).not.toHaveBeenCalled();
            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_EVAL_FAILED_EVENT, {
                tenantId,
                agentId,
                runId: null,
                status: 'failed',
            });
        });
    });

    describe('SimulationService', () => {
        function makeService(agent: any) {
            const prisma = {
                getTenantSchemaName: jest.fn().mockResolvedValue('tenant_simulation'),
                executeInTenantSchema: jest.fn()
                    .mockResolvedValueOnce([{
                        id: runId,
                        agent_id: agentId,
                        channel_type: 'whatsapp',
                        scenario_source: 'synthetic',
                        scenario_count: 1,
                        baseline_run_id: null,
                        vertical: null,
                    }])
                    .mockResolvedValue(undefined),
            };
            const eventEmitter = { emit: jest.fn() };
            const qualityService = { judgeTranscript: jest.fn() };
            const agentTest = { test: jest.fn() };
            const service = new SimulationService(
                prisma as any,
                {} as any,
                {} as any,
                { getAgent: jest.fn().mockResolvedValue(agent) } as any,
                qualityService as any,
                agentTest as any,
                {} as any,
                eventEmitter as any,
            );
            jest.spyOn(service, 'ensureTables').mockResolvedValue(undefined);
            return { service, prisma, eventEmitter, qualityService, agentTest };
        }

        it('emits completion only after the run is stored as completed', async () => {
            const { service, eventEmitter } = makeService({ version: 3, config_json: {} });
            jest.spyOn(service as any, 'generateSyntheticScenarios').mockResolvedValue([{
                key: 'greeting',
                title: 'Greeting',
                goal: 'Greet the customer',
                language: 'es',
                source: 'synthetic',
                openingMessage: 'Hola',
            }]);
            jest.spyOn(service as any, 'runScenariosConcurrently').mockResolvedValue([{
                judge: { overall: 8, resolved: true },
            }]);
            jest.spyOn(service as any, 'buildSummary').mockResolvedValue({});

            await expect(service.executeRun(tenantId, runId)).resolves.toBeUndefined();

            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_SIMULATION_COMPLETED_EVENT, {
                tenantId,
                agentId,
                runId,
                status: 'completed',
            });
        });

        it('emits failure and rejects so the worker cannot mark a broken run successful', async () => {
            const { service, eventEmitter } = makeService(null);

            await expect(service.executeRun(tenantId, runId)).rejects.toThrow(`Agent ${agentId} not found`);

            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_SIMULATION_FAILED_EVENT, {
                tenantId,
                agentId,
                runId,
                status: 'failed',
            });
        });

        it('propagates a judge failure instead of manufacturing an empty zero judge', async () => {
            const { service, qualityService, agentTest } = makeService({ version: 3, config_json: {} });
            agentTest.test.mockResolvedValue({ reply: 'Hola, ¿cómo te ayudo?' });
            qualityService.judgeTranscript.mockRejectedValue(new Error('judge unavailable'));

            await expect((service as any).runScenario(
                tenantId,
                agentId,
                'whatsapp',
                {
                    key: 'judge', title: 'Judge', goal: 'Test', language: 'es',
                    source: 'replay', openingMessage: 'Hola', replayMessages: ['Hola'],
                },
            )).rejects.toThrow('judge unavailable');
        });

        it('fails the run when every scenario is unscorable', async () => {
            const { service, eventEmitter } = makeService({ version: 3, config_json: {} });
            const scenario = {
                key: 'judge', title: 'Judge', goal: 'Test', language: 'es',
                source: 'synthetic', openingMessage: 'Hola',
            };
            jest.spyOn(service as any, 'generateSyntheticScenarios').mockResolvedValue([scenario]);
            jest.spyOn(service as any, 'runScenariosConcurrently').mockResolvedValue([{
                ...scenario, transcript: [], turns: 0, latencyMs: 10,
                judge: null, error: 'judge unavailable',
            }]);
            const buildSummary = jest.spyOn(service as any, 'buildSummary').mockResolvedValue({});

            await expect(service.executeRun(tenantId, runId))
                .rejects.toThrow('Simulation produced no scorable scenarios');
            expect(buildSummary).not.toHaveBeenCalled();
            expect(eventEmitter.emit).toHaveBeenCalledWith(AGENT_SIMULATION_FAILED_EVENT, {
                tenantId, agentId, runId, status: 'failed',
            });
        });
    });
});
