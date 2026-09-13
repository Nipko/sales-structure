/* Read-only audit: synthetic dependencies, no DB, providers, or network.
 * Run from repository root: node docs/audits/2026-09-05/reproduce-quality.cjs
 * Assertions document current gaps; passing is NOT a product acceptance test.
 */
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
require('@nestjs/common').Logger.overrideLogger([]);
const { AgentQualityService } = require(path.join(root, 'apps/api/src/modules/quality/agent-quality.service.ts'));
const { QualityService } = require(path.join(root, 'apps/api/src/modules/quality/quality.service.ts'));

async function main() {
  const service = new AgentQualityService({
    executeInTenantSchema: async () => { throw new Error('Synthetic unavailable source'); },
  });
  const agent = { updated_at: '2026-09-04T00:00:00Z', version: 2 };
  const latestEval = {
    id: 'audit-eval', created_at: '2026-09-05T00:00:00Z', passed: true,
    eval_activable: true, avg_score: 9, k: 3, threshold: 7,
  };
  const freshEvalOnly = service.buildTestedPillar(agent, { latestEval, latestSimulation: null }, null);
  const freshEvalWithOldSimulation = service.buildTestedPillar(agent, {
    latestEval,
    latestSimulation: {
      id: 'audit-simulation', created_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T00:00:00Z',
      persona_version: 1, avg_score: 9,
    },
  }, null);
  assert.equal(freshEvalOnly.status, 'evidenced');
  assert.equal(freshEvalWithOldSimulation.status, 'stale');

  const unreadableFacts = await service.loadReadinessFacts('audit_synthetic');
  assert.equal(unreadableFacts.knowledgeChunks, 0);
  assert.equal(unreadableFacts.products, 0);
  assert.equal(unreadableFacts.services, 0);

  let capturedRead = '';
  let capturedTranscript = '';
  const qa = new QualityService({
    getTenantSchemaName: async () => 'audit_synthetic',
    executeInTenantSchema: async (_schema, sql) => {
      if (sql.includes('SELECT resolution_type')) return [{
        resolution_type: 'ai_resolved', was_handed_off: false,
        agent_persona_id: '11111111-1111-4111-8111-111111111111', agent_config_version: 2,
      }];
      if (sql.includes('SELECT content_text')) {
        capturedRead = sql;
        return [
          { direction: 'inbound', content_text: 'Necesito reservar.' },
          { direction: 'outbound', content_text: 'Tu reserva quedó confirmada.' },
        ];
      }
      return [];
    },
  }, {}, {}, {}, { emit: () => {} });
  qa.ensureTables = async () => {};
  qa.judgeTranscript = async (_tenant, transcript) => {
    capturedTranscript = transcript;
    return { overall: 9, resolution: 9, tone: 9, accuracy: 9, empathy: 9,
      flags: [], resolved: true, resolutionReason: 'Synthetic judge result' };
  };
  await qa.scoreConversation('audit-tenant', 'audit-conversation');
  assert.match(capturedRead, /ORDER BY created_at ASC\s+LIMIT 40/);
  assert.match(capturedTranscript, /Tu reserva quedó confirmada/);
  console.log(JSON.stringify({
    freshEvalOnly: freshEvalOnly.status,
    freshEvalWithOldSimulation: freshEvalWithOldSimulation.status,
    staleReasons: freshEvalWithOldSimulation.staleReasons,
    unreadableSourcesBecomeCounts: {
      knowledge: unreadableFacts.knowledgeChunks, products: unreadableFacts.products,
      services: unreadableFacts.services,
    },
    qaReadsFirstFortyMessages: true,
    qaJudgesTranscriptWithoutBookingEvidence: true,
    scope: 'Synthetic dependencies; no real conversation, DB, or LLM was evaluated.',
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
