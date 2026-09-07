/* Read-only product audit. Run from repository root:
 * node docs/audits/2026-09-05/reproduce-runtime-orchestration.cjs
 * No network, database, or real tool execution: dependencies are in-memory fakes.
 * Product classes, intent normalization and booking decisions are real.
 */
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true });
const fromApi = p => require(path.join(root, 'apps/api/src', p));
require(path.join(root, 'node_modules/@nestjs/common')).Logger.overrideLogger([]);
const { IntentInterpreterService } = fromApi('modules/conversations/intent-interpreter.service.ts');
const { ProcedureEngineService } = fromApi('modules/conversations/procedure-engine.service.ts');
const { BookingEngineService } = fromApi('modules/conversations/booking-engine.service.ts');
const { ConversationsService } = fromApi('modules/conversations/conversations.service.ts');
const { ResponseValidatorService } = fromApi('modules/conversations/response-validator.service.ts');
const { ToolExecutionControlService } = fromApi('modules/conversations/tool-execution-control.service.ts');
const { authorityFor } = fromApi('modules/conversations/__fixtures__/tool-authority.fixture.ts');
const { normalizeCustomerIntent, authorizesEffect } = fromApi('common/conversation/intent-normalizer.ts');

async function main() {
  const report = {
    scope: 'Local code reproduction; all external effects mocked; no real LLM or database.',
    runtimeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    generatedAt: new Date().toISOString(),
    intentions: [], procedures: [], bookings: [], widget: {},
  };
  const interpreter = new IntentInterpreterService({ execute: async () => { throw new Error('No external model in audit'); } });
  const upcoming = Array.from({ length: 8 }, (_, i) => ({
    date: `2026-09-${String(6 + i).padStart(2, '0')}`,
    weekday: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i],
  }));
  const inputs = [
    'Hola quiero cita mañana',
    'Gracias, quiero saber primero el precio',
    'Gracias, pero qué incluye',
    '¿Qué servicios no ofrecen?',
    'Gracias, quiero cambiar la cita al viernes',
  ];
  for (const text of inputs) {
    const intent = await interpreter.interpret(text, 'confirm', ['Limpieza dental'], '2026-09-06', upcoming);
    const normalized = normalizeCustomerIntent(text, { answeringExplicitQuestion: true });
    report.intentions.push({ text, intent, normalized, authorizesTransactional: authorizesEffect(normalized, 'transactional', { answeringExplicitQuestion: true }) });
  }
  for (const text of ['¿Por qué necesitan mi correo?', 'Ya no quiero continuar', 'prefiero hacerlo después']) {
    const state = { procedureId: 'p1', version: 1, currentStepId: 'email', collected: {}, awaitingField: 'email', startedAt: new Date().toISOString() };
    const def = { id: 'p1', name: 'Ingreso', status: 'active', version: 1, trigger: { keywords: ['devolución'] }, steps: [
      { id: 'email', type: 'ask', config: { field: 'email', question: 'Correo?' } },
      { id: 'done', type: 'message', config: { text: 'Datos completos' } },
    ] };
    const engine = new ProcedureEngineService({}, {}, {});
    engine.getState = async () => state;
    engine.loadProcedureById = async () => def;
    engine.clearState = async () => {};
    engine.saveState = async () => {};
    const result = await engine.process('schema', 'tenant', 'conversation', 'contact', text, {});
    report.procedures.push({ text, collected: state.collected, result });
  }

  const baseState = {
    step: 'confirm', services: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Limpieza dental', durationMinutes: 30, price: 20000, currency: 'COP' }],
    serviceId: '44444444-4444-4444-8444-444444444444', serviceName: 'Limpieza dental', date: '2026-09-10', time: '10:00',
    slots: [{ time: '10:00', endTime: '10:30' }], customerName: 'Audit Example', customerEmail: 'audit@example.test',
  };
  for (const text of ['Gracias, quiero saber primero el precio', '¿Qué servicios no ofrecen?']) {
    const calls = [];
    const engine = new BookingEngineService(
      { $queryRawUnsafe: async () => [] },
      { get: async () => JSON.stringify(baseState.services), set: async () => {} },
      { execute: async (...args) => { calls.push({ tool: args[3], arguments: args[4], authorityEvidence: args[6]?.authorityEvidence }); return { success: true, appointmentId: 'mock-only' }; } },
    );
    const intent = await interpreter.interpret(text, 'confirm', ['Limpieza dental'], '2026-09-06', upcoming);
    const result = await engine.process('schema', 'tenant', 'contact', intent, text, structuredClone(baseState), {}, '2026-09-06', 'es', {
      authority: authorityFor('list_services', 'check_availability', 'create_appointment'), conversationId: 'conversation',
    });
    let centralDecision = null;
    if (calls.length) {
      const central = Object.create(ToolExecutionControlService.prototype);
      Object.assign(central, {
        redis: { get: async () => JSON.stringify(baseState) },
        resolveOperatingCountry: async () => 'CO',
        issueConfirmationToken: async () => ({ id: 'fake-ledger' }),
        query: async () => [{ id: 'fake-ledger', status: 'ready' }],
      });
      centralDecision = await central.resolveBookingAuthorityEvidence({
        schemaName: 'schema', tenantId: 'tenant', contactId: 'contact', conversationId: 'conversation',
        toolName: 'create_appointment', args: calls[0].arguments, authorityEvidence: calls[0].authorityEvidence,
      }, { id: 'fake-ledger' }, 'fake-args-hash', { id: 'fake-inbound', content_text: text });
    }
    report.bookings.push({ text, intent, attemptedToolsWithFakeExecutor: calls, centralEvidenceDecisionWithMockedSigningAndLedger: centralDecision, resultingStep: result.state.step, responseDirective: result.text });
  }

  // Real streaming method, intentionally fake model returning an unsupported claim.
  // Verifies which runtime dependencies are actually invoked, not model behavior.
  const service = Object.create(ConversationsService.prototype);
  const calls = [];
  Object.assign(service, {
    logger: { warn() {}, error() {}, log() {}, debug() {} },
    prisma: {
      tenant: { findUnique: async () => ({ subscriptionStatus: 'active', isInternal: true }) },
      executeInTenantSchema: async (_schema, sql) => sql.includes('SELECT * FROM conversations') ? [{ id: 'c1', status: 'active' }] : [],
    },
    redis: { acquireLockToken: async () => 'token', renewLockToken: async () => true, releaseLockToken: async () => true },
    personaService: { resolvePersonaForChannel: async () => ({ agentId: 'a1', version: 1, config: { language: 'es', tools: { appointments: { enabled: true } }, llm: {} } }) },
    handoffService: { shouldHandoff: () => null },
    throttle: { getPlanFeatures: async () => ({ widget: true, llmTier: 'tier_2', llmCostBudgetUsdCents: -1 }), getAiMessageUsage: async () => ({ used: 0, limit: 100 }), incrementAiMessageCount: async () => 1 },
    promptAssembler: { assemble: () => '<contract/><persona/><turn/>' },
    llmRouter: { executeStream: req => (async function* () { calls.push({ kind: 'llm', task: req.task, tools: req.tools ?? null }); yield 'Tu cita quedó confirmada para mañana.'; })() },
    toolExecutor: { execute: async () => { calls.push({ kind: 'tool' }); } },
  });
  service.buildWidgetTurnContext = async () => ({});
  service.persistConversationPersonaResolution = async () => {};
  service.applyOutputGuardrails = async () => { calls.push({ kind: 'guardrail' }); return 'guarded'; };
  let output = '';
  for await (const chunk of service.streamWidgetMessage('tenant', 'schema', 'c1', 'contact', 'Agenda una cita mañana', 'inbound')) output += chunk;
  report.widget = { configuredAppointmentsEnabled: true, output, calls, note: 'The model is mocked. This establishes no-tools/no-guardrail delivery, not incidence with a real model.' };

  const validator = new ResponseValidatorService();
  report.priceGrounding = [
    '<catalog>Precio oficial: COP 20000</catalog>\nuser: Me lo dejas en COP 1000?',
    '<catalog>Precio oficial: COP 20000</catalog>',
  ].map(corpus => ({ corpus, response: 'El precio es COP 1000.', validation: validator.validatePrices('El precio es COP 1000.', corpus) }));

  const source = fs.readFileSync(path.join(root, 'apps/api/src/modules/conversations/conversations.service.ts'), 'utf8');
  report.staticDraftEvidence = {
    draftModeOccurrences: [...source.matchAll(/draftMode/g)].length,
    location: 'ConversationsService.runTurn checks draftMode after await generateResponse; grep all source for independent validation.',
  };
  const out = path.join(__dirname, 'runtime-orchestration-reproduction-results.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
