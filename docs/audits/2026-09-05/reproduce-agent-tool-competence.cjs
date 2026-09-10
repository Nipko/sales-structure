/** Read-only audit: real service methods, isolated in-memory dependency fixtures.
 * Run from repository root: node docs/audits/2026-09-05/reproduce-agent-tool-competence.cjs
 * No database, providers, queues, or tenant records are accessed.
 */
require('ts-node').register({ project: 'apps/api/tsconfig.json', transpileOnly: true });
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const api = (name) => require(path.join(root, 'apps/api/src', name));
const { AIToolExecutorService } = api('modules/conversations/ai-tool-executor.service');
const { ToolExecutionControlService } = api('modules/conversations/tool-execution-control.service');
const { GymsService } = api('modules/gyms/gyms.service');
const { resolvePaymentPolicy } = api('common/utils/payment-policy.util');
const { ToolRetrievalService } = api('modules/conversations/tool-retrieval.service');
const { staticToolsForAgentConfig } = api('modules/conversations/agent-tool-registry');
const { isConfirmableWriteTool } = api('modules/conversations/tool-policy-registry');

const serviceId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const appointmentId = '33333333-3333-4333-8333-333333333333';
const silentLogger = { log() {}, warn() {}, debug() {}, error() {} };

async function main() {
  const evidence = {
    scope: 'Local isolated reproductions using actual TypeScript methods; dependency fixtures only; no live tenant validation.',
    checks: {},
  };

  // Approved MCP reads remain blocked by the unresolved opaque policy.
  const control = Object.create(ToolExecutionControlService.prototype);
  evidence.checks.approvedMcpRead = await control.preflight({
    toolName: 'mcp__crm__lookup',
    mcpApproval: {
      serverId: 'crm', toolName: 'lookup', effect: 'read',
      requiresConfirmation: false, requiresHumanApproval: false,
      approvedBy: 'fixture-owner', approvedAt: '2026-09-05T12:00:00Z',
    },
  });

  // Public schema says full classes enter the waitlist, but bookClass rejects
  // before reaching its waitlist branch when the initial read is already full.
  const gym = Object.create(GymsService.prototype);
  let gymQueries = 0;
  gym.prisma = { executeInTenantSchema: async () => {
    gymQueries += 1;
    return [{ id: serviceId, available_spots: 0, is_cancelled: false }];
  } };
  try {
    evidence.checks.fullClassWaitlist = await gym.bookClass('fixture', serviceId, contactId);
  } catch (error) {
    evidence.checks.fullClassWaitlist = { error: error.message, queryCount: gymQueries };
  }

  // Appointment handler receives a genuine configured payment mode. Its
  // capacity helper reads the same policy but the handler ignores the result.
  const executor = Object.create(AIToolExecutorService.prototype);
  const service = {
    id: serviceId, name: 'Consulta con anticipo', is_active: true,
    duration_minutes: 30, duration_type: 'fixed', price: 100000, currency: 'COP',
    location_type: 'in_person', payment_policy: 'deposit', deposit_percent: 30,
    max_concurrent: 1,
  };
  let appointmentInsert = '';
  const query = async (sql, params = []) => {
    if (sql.includes('SELECT id FROM contacts')) return [{ id: contactId }];
    if (sql.includes('FROM opportunities')) return [];
    if (sql.includes('FROM services')) return [service];
    if (sql.includes('COUNT(*)')) return [{ occupied: 0 }];
    if (sql.includes('INSERT INTO appointments')) {
      appointmentInsert = sql;
      return [{ id: appointmentId, status: 'confirmed' }];
    }
    return [];
  };
  executor.logger = silentLogger;
  executor.prisma = {
    $queryRawUnsafe: async (sql) => sql.includes('services') ? [service] : [],
    transactionInTenantSchema: async (_, callback) => callback(query),
  };
  executor.temporalContracts = { normalize: () => ({ kind: 'appointment', endsAtLocal: '2026-09-08T10:30:00' }) };
  executor.getTenantTimezone = async () => 'America/Bogota';
  executor.resolveAppointmentSubject = async () => ({ suggestedStaffId: null, labels: [], metadata: {} });
  executor.acquireSlotLock = async () => ({ key: 'fixture', token: 'fixture' });
  executor.redis = { releaseLockToken: async () => {} };
  // Direct handler with evalMode=true suppresses notification/outbox effects;
  // SQL status/amount/hold behavior is the same as its live branch.
  const appointment = await executor.createAppointment('fixture', serviceId, contactId, {
    serviceId, date: '2026-09-08', time: '10:00', customerName: 'Audit fixture',
  }, undefined, true);
  evidence.checks.appointmentDeposit = {
    configuredPolicy: resolvePaymentPolicy(service, service.price),
    result: appointment,
    insertHasConfirmedLiteral: appointmentInsert.includes("'confirmed'"),
    insertHasAmountDue: appointmentInsert.includes('amount_due'),
    insertHasHoldExpiresAt: appointmentInsert.includes('hold_expires_at'),
    returnedPayableReference: appointment?.appointment?.payableReference ?? null,
  };

  // Failure after enrollment status is committed but before capacity return:
  // next retry sees dropped and cannot repair the lost seat.
  const educationExecutor = Object.create(AIToolExecutorService.prototype);
  const enrollment = { id: appointmentId, contact_id: contactId, status: 'enrolled', cohort_id: serviceId, notes: null };
  let seatReturnAttempts = 0;
  educationExecutor.prisma = { $queryRawUnsafe: async (sql) => {
    if (sql.includes('SELECT')) return [{ ...enrollment }];
    seatReturnAttempts += 1;
    throw new Error('isolated_fixture_capacity_write_failure');
  } };
  educationExecutor.educationService = { updateEnrollment: async (_, __, update) => {
    Object.assign(enrollment, update);
    return { ...enrollment };
  } };
  const firstCancellation = await educationExecutor.cancelEnrollment('fixture', contactId, appointmentId, 'Retiro');
  const retryCancellation = await educationExecutor.cancelEnrollment('fixture', contactId, appointmentId, 'Retiro');
  evidence.checks.enrollmentCancellationFailure = {
    firstCancellation, retryCancellation, finalStatus: enrollment.status,
    seatReturnAttempts, capacityRestored: false,
  };

  // Actual retrieval with a plausible multi-capability gym candidate set.
  // This illustrates dependency loss, not every tenant's final published set.
  const cfg = Object.fromEntries(['appointments', 'catalog', 'faqs', 'policies', 'knowledge', 'crm', 'gyms'].map(k => [k, { enabled: true }]));
  const candidates = staticToolsForAgentConfig(cfg);
  const pinned = new Set(candidates.filter(t => isConfirmableWriteTool(t.name)).map(t => t.name));
  const retrieval = new ToolRetrievalService();
  retrieval.logger = silentLogger;
  const retrievalQuery = 'quiero cancelar mi clase de yoga gimnasios idle';
  const selected = retrieval.retrieveRelevantTools(retrievalQuery, candidates, 10, pinned).map(t => t.name);
  evidence.checks.retrievalDependencyLoss = {
    query: retrievalQuery, candidateCount: candidates.length, selected,
    bookClassPresent: selected.includes('book_class'),
    requiredMembershipReaderPresent: selected.includes('get_my_membership'),
  };

  const output = path.join(__dirname, 'agent-tool-competence-evidence.json');
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
