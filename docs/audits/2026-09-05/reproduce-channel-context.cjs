/* Read-only audit reproduction: no DB, Redis, network, or LLM calls. */
const path = require('node:path');
const workspace = path.resolve(__dirname, '../../..');
require('ts-node').register({
  project: path.join(workspace, 'apps/api/tsconfig.json'),
  transpileOnly: true,
});

const { AgentQualityService } = require(path.join(workspace, 'apps/api/src/modules/quality/agent-quality.service.ts'));
const { CopilotService } = require(path.join(workspace, 'apps/api/src/modules/copilot/copilot.service.ts'));
const tenantId = '11111111-1111-4111-8111-111111111111';
const prisma = {
  getTenantSchemaName: async () => 'audit_tenant',
  tenant: { findUnique: async () => ({ settings: {}, industry: 'retail' }) },
  whatsappCredential: { findMany: async () => [] },
  executeInTenantSchema: async () => [],
  $queryRawUnsafe: async (sql) => {
    if (sql.includes('FROM channel_accounts')) {
      throw new Error('simulated temporary db failure');
    }
    return [];
  },
};

(async () => {
  const quality = new AgentQualityService(prisma);
  const source = await quality.loadTenantContext(tenantId, 'audit_tenant');
  const snapshot = await quality.getTenantChannelSnapshot(tenantId);
  const assistant = new CopilotService(null, null, null, null, null, null, null, null, quality, null);
  const prompt = await assistant.buildChannelContext(tenantId, 'tenant_admin');
  const unknownBecameAuthoritativeEmpty = source.channelLookupAvailable === false
    && snapshot.total === 0
    && snapshot.channels.length === 0
    && prompt.includes('autoritativo')
    && prompt.includes('Si la lista está vacía, indícalo');
  process.stdout.write(JSON.stringify({
    reproduction: 'unavailable channel lookup becomes authoritative empty channel context',
    externalServicesUsed: false,
    sourceAvailable: source.channelLookupAvailable,
    snapshot,
    prompt,
    defectReproduced: unknownBecameAuthoritativeEmpty,
  }, null, 2) + '\n');
})().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
