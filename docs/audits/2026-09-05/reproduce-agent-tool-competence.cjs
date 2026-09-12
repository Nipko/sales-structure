/** Read-only audit: real service methods, isolated in-memory dependency fixtures.
 * Run from repository root: node docs/audits/2026-09-05/reproduce-agent-tool-competence.cjs
 * No database, providers, queues, or tenant records are accessed.
 */
require('ts-node').register({ project: 'apps/api/tsconfig.json', transpileOnly: true });
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const api = (name) => require(path.join(root, 'apps/api/src', name));
const { AIToolExecutorService } = api('modules/conversations/ai-tool-executor.service');
const { ToolExecutionControlService } = api('modules/conversations/tool-execution-control.service');
const { GymsService } = api('modules/gyms/gyms.service');
const { EducationService } = api('modules/education/education.service');
const { resolvePaymentPolicy } = api('common/utils/payment-policy.util');
const { appointmentServiceTerms } = api('modules/appointments/appointment-service-terms');
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

  // A full class enters a durable waitlist without spending a member credit.
  // This used to reject before reaching the waitlist branch.
  const gym = Object.create(GymsService.prototype);
  let gymQueries = 0;
  const gymMember = { id: contactId, contact_id: contactId, status: 'active', class_credits_remaining: 3 };
  const gymBookings = [];
  const gymQuery = async (sql, params = []) => {
    gymQueries += 1;
    if (sql.includes('pg_advisory_xact_lock') || sql.includes('to_regclass') || sql.startsWith('CREATE ')) return [];
    if (sql.startsWith('SELECT * FROM fitness_classes')) return [{ id: serviceId, available_spots: 0, is_cancelled: false, scheduled_at: '2099-01-01', credits_required: 1 }];
    if (sql.startsWith('SELECT * FROM members')) return [{ ...gymMember }];
    if (sql.startsWith('SELECT * FROM class_bookings WHERE class_id')) return [];
    if (sql.startsWith('INSERT INTO class_bookings')) {
      const booking = { id: appointmentId, class_id: params[0], member_id: params[1], contact_id: params[2], credits_used: params[3], status: params[4] };
      gymBookings.push(booking);
      return [{ ...booking }];
    }
    if (sql.startsWith('SELECT COUNT')) return [{ n: 1 }];
    return [];
  };
  gym.prisma = { transactionInTenantSchema: async (_, callback) => callback(gymQuery) };
  try {
    evidence.checks.fullClassWaitlist = await gym.bookClass('fixture', serviceId, contactId);
    evidence.checks.fullClassWaitlist.creditBalance = gymMember.class_credits_remaining;
    evidence.checks.fullClassWaitlist.persistedBookings = gymBookings.length;
  } catch (error) {
    evidence.checks.fullClassWaitlist = { error: error.message, queryCount: gymQueries };
  }

  // The executor must pass the exact reviewed terms to the appointment command
  // and report the command's pending-payment state without upgrading it to a
  // confirmed booking. The command is the dependency fixture; the orchestration
  // below is the production AIToolExecutorService method.
  const executor = Object.create(AIToolExecutorService.prototype);
  const service = {
    id: serviceId, name: 'Consulta con anticipo', is_active: true,
    duration_minutes: 30, duration_type: 'fixed', price: 100000, currency: 'COP',
    location_type: 'in_person', payment_policy: 'deposit', deposit_percent: 30,
    max_concurrent: 1,
  };
  let appointmentCommand;
  const query = async (sql, params = []) => {
    if (sql.includes('SELECT id FROM contacts')) return [{ id: contactId }];
    if (sql.includes('FROM opportunities')) return [];
    if (sql.includes('FROM services')) return [service];
    if (sql.includes('COUNT(*)')) return [{ occupied: 0 }];
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
  executor.appointmentsService = { create: async (...call) => {
    appointmentCommand = call;
    return {
      id: appointmentId,
      serviceName: service.name,
      status: 'pending_payment',
      metadata: { serviceTerms: appointmentServiceTerms(service) },
      awaitingPayment: true,
      amountDueToConfirm: 30000,
      paymentChoice: undefined,
      currency: 'COP',
      paymentStatus: 'pending',
      holdExpiresAt: '2026-09-08T15:20:00.000Z',
    };
  } };
  // Direct handler with evalMode=true suppresses notification/outbox effects;
  // SQL status/amount/hold behavior is the same as its live branch.
  const appointment = await executor.createAppointment('fixture', serviceId, contactId, {
    serviceId, date: '2026-09-08', time: '10:00', customerName: 'Audit fixture',
    appointmentTerms: appointmentServiceTerms(service),
  }, undefined, true);
  evidence.checks.appointmentDeposit = {
    configuredPolicy: resolvePaymentPolicy(service, service.price),
    result: appointment,
    commandReceivedReviewedTerms: JSON.stringify(appointmentCommand?.[2]?.expectedServiceTerms)
      === JSON.stringify(appointmentServiceTerms(service)),
    commandSuppressedExternalEffects: appointmentCommand?.[2]?.suppressEffects === true,
    returnedPayableReference: appointment?.appointment?.payableReference ?? null,
  };

  // Enrollment cancellation and seat restoration are one transaction. A
  // capacity failure must roll the status back so the retry can finish once.
  let educationState = {
    enrollment: { id: appointmentId, contact_id: contactId, status: 'enrolled', cohort_id: serviceId },
    seats: 0,
    cohortStatus: 'full',
  };
  let failCapacity = true;
  let seatReturnAttempts = 0;
  const educationQuery = async (sql) => {
    if (sql.includes('pg_advisory_xact_lock') || sql.includes('to_regclass') || sql.startsWith('CREATE ') || sql.includes('FROM courses')) return [];
    if (sql.includes('SELECT * FROM course_cohorts')) return [{ id: serviceId, available_seats: educationState.seats, status: educationState.cohortStatus, starts_at: '2099-01-01' }];
    if (sql.includes('SELECT')) return [{ ...educationState.enrollment }];
    if (sql.includes('UPDATE enrollments')) { educationState.enrollment.status = 'dropped'; return []; }
    if (sql.includes('UPDATE course_cohorts')) {
      seatReturnAttempts += 1;
      if (failCapacity) throw new Error('isolated_fixture_capacity_write_failure');
      educationState.seats += 1;
      educationState.cohortStatus = 'open';
      return [{ id: serviceId }];
    }
    throw new Error(`unexpected education SQL: ${sql}`);
  };
  const education = new EducationService({ transactionInTenantSchema: async (_, callback) => {
    const snapshot = structuredClone(educationState);
    try { return await callback(educationQuery); }
    catch (error) { educationState = snapshot; throw error; }
  } });
  let firstCancellation;
  try { firstCancellation = await education.cancelEnrollment('tenant_fixture', appointmentId, { contactId, reason: 'Retiro' }); }
  catch (error) { firstCancellation = { error: error.message }; }
  const afterFailedCancellation = structuredClone(educationState);
  failCapacity = false;
  const retryCancellation = await education.cancelEnrollment('tenant_fixture', appointmentId, { contactId, reason: 'Retiro' });
  evidence.checks.enrollmentCancellationFailure = {
    firstCancellation,
    afterFailedCancellation,
    retryCancellation,
    finalStatus: educationState.enrollment.status,
    seatReturnAttempts,
    capacityRestored: educationState.seats === 1,
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

  assert.equal(evidence.checks.approvedMcpRead.allowed, false, 'opaque MCP reads must remain blocked');
  assert.equal(evidence.checks.fullClassWaitlist.status, 'waitlist');
  assert.equal(evidence.checks.fullClassWaitlist.creditBalance, 3, 'waitlisting must not consume credit');
  assert.equal(evidence.checks.fullClassWaitlist.persistedBookings, 1);
  assert.equal(evidence.checks.appointmentDeposit.result.operationStatus, 'awaiting_payment');
  assert.equal(evidence.checks.appointmentDeposit.commandReceivedReviewedTerms, true);
  assert.ok(evidence.checks.appointmentDeposit.returnedPayableReference, 'pending payment needs a payable reference');
  assert.equal(evidence.checks.enrollmentCancellationFailure.afterFailedCancellation.enrollment.status, 'enrolled');
  assert.equal(evidence.checks.enrollmentCancellationFailure.afterFailedCancellation.seats, 0);
  assert.equal(evidence.checks.enrollmentCancellationFailure.retryCancellation.success, true);
  assert.equal(evidence.checks.enrollmentCancellationFailure.capacityRestored, true);
  assert.equal(evidence.checks.retrievalDependencyLoss.requiredMembershipReaderPresent, true);

  const output = path.join(__dirname, 'agent-tool-competence-evidence.json');
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
