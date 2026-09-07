/* Current-source audit. Run from repository root:
 * node docs/audits/2026-09-05/reproduce-knowledge-learning.cjs
 * Real service methods; database, embeddings and model dependencies are isolated
 * in-memory fakes. No network, real customer data or product mutations.
 * Assertions reproduce present gaps; they are not acceptance tests.
 */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
require(path.join(root, 'node_modules/ts-node')).register({
  project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true,
});
require(path.join(root, 'node_modules/@nestjs/common')).Logger.overrideLogger([]);
const fromApi = p => require(path.join(root, 'apps/api/src', p));
const { KnowledgeService } = fromApi('modules/knowledge/knowledge.service.ts');
const { AIToolExecutorService } = fromApi('modules/conversations/ai-tool-executor.service.ts');
const { CustomerMemoryService } = fromApi('modules/conversations/customer-memory.service.ts');
const { ComplianceService } = fromApi('modules/compliance/compliance.service.ts');
const tenant = '11111111-1111-4111-8111-111111111111';
const contact = '22222222-2222-4222-8222-222222222222';
const document = '33333333-3333-4333-8333-333333333333';
const chunk = '44444444-4444-4444-8444-444444444444';
const schema = 'tenant_synthetic_audit';

function makeKnowledge(prisma = {}) {
  const service = new KnowledgeService(prisma, {}, {}, {}, {}, {});
  service.tenantSchema = async () => schema;
  service.ensureKbSearchVector = async () => {};
  service.embedQueryCached = async () => [0.1, 0.2];
  service.trackRetrieval = async () => {};
  return service;
}

async function metadataAndThreshold() {
  const source = {
    chunk_id: chunk, document_id: document, title: 'Synthetic regulated reference',
    chunk_text: 'General regulation content', distance: 0.92, doc_language: 'es',
    doc_is_regulated: true, doc_jurisdiction: 'CO', doc_authority: 'Synthetic authority',
    doc_valid_from: '2026-01-01', doc_valid_to: '2026-12-31',
  };
  const knowledge = makeKnowledge({
    executeInTenantSchema: async (_schema, sql) =>
      /FROM knowledge_embeddings/.test(sql) && / AS distance/.test(sql) ? [source] : [],
  });
  knowledge.tenantHasKnowledge = async () => true;
  const result = await knowledge.searchRelevant(tenant, 'unrelatedquestion', 5, { jurisdiction: 'CO' });
  const metadata = ['doc_is_regulated', 'doc_jurisdiction', 'doc_authority', 'doc_valid_from', 'doc_valid_to'];
  const missing = metadata.filter(key => !(key in result[0]));
  assert.equal(missing.length, 5);
  const executor = Object.create(AIToolExecutorService.prototype);
  executor.knowledgeService = knowledge;
  const toolRead = await executor.searchKnowledgeBase(tenant, 'unrelatedquestion', 5, undefined, 'CO');
  assert.equal(toolRead.chunks.length, 1);
  assert(toolRead.chunks[0].score < 0.25);
  assert.equal(toolRead.status, 'ok');
  return {
    metadata: { inputMetadata: Object.fromEntries(metadata.map(key => [key, source[key]])), returnedKeys: Object.keys(result[0]), missing },
    explicitToolRead: toolRead,
    automaticPipelineClassificationAtDefaultThreshold: {
      retrieved: result.filter(row => row.score >= 0.35).length,
      possible: result.filter(row => row.score >= 0.25 && row.score < 0.35).length,
    },
  };
}

async function gapContract() {
  const knowledge = makeKnowledge({
    executeInTenantSchema: async (_schema, sql) => {
      if (sql.includes('FROM kb_unanswered_queries')) return [{ id: 'query-a', query: 'Synthetic query' }];
      if (sql.includes('WHERE satisfaction_score < 3')) return [{ id: document, satisfaction_score: 1 }];
      if (sql.includes('LEFT JOIN LATERAL')) return [{ id: document, title: 'Synthetic stale document' }];
      if (sql.includes('FROM kb_feedback fb')) return [{ document_id: document, false_positive_count: 2 }];
      throw new Error(`Unexpected audit SQL: ${sql}`);
    },
  });
  knowledge.ensureKbFeedbackTable = async () => {};
  const data = await knowledge.getGapReport(tenant, 30);
  const dashboardSource = fs.readFileSync(path.join(root, 'apps/dashboard/src/app/admin/knowledge/page.tsx'), 'utf8');
  for (const expression of [
    'gapReport.lowSatisfaction?.length ?? 0', 'gapReport.staleDocs?.length ?? 0',
    'gapReport.falsePositiveCount ?? 0',
  ]) assert(dashboardSource.includes(expression), `Consumer changed: ${expression}`);
  const uiKpisUsingCurrentConsumerExpressions = {
    unanswered: data.unansweredQueries?.length ?? 0,
    lowSatisfaction: data.lowSatisfaction?.length ?? 0,
    stale: data.staleDocs?.length ?? 0,
    falsePositives: data.falsePositiveCount ?? 0,
  };
  assert.deepEqual(uiKpisUsingCurrentConsumerExpressions, { unanswered: 1, lowSatisfaction: 0, stale: 0, falsePositives: 0 });
  return { apiData: data, uiKpisUsingCurrentConsumerExpressions, scope: 'API/consumer property contract; no browser render.' };
}

async function forgottenFactReturns() {
  const oldFact = 'Prefiere contacto por telefono.';
  const replacementFact = 'Prefiere contacto por correo; dejo de usar telefono.';
  let merged = { facts: [oldFact], summary: 'Synthetic customer.' };
  let semantic = [{ owner_kind: 'contact', owner_id: contact, fact_text: oldFact, sequence: 1 }];
  const prisma = {
    executeInTenantSchema: async (_schema, sql, params = []) => {
      if (sql.includes('FROM messages')) return [{ direction: 'inbound', content_text: replacementFact }];
      if (sql.startsWith('CREATE ')) return [];
      if (sql.includes('SELECT facts, summary FROM customer_memories')) return [merged];
      if (sql.includes('SELECT customer_profile_id FROM contact_identities')) return [];
      if (sql.includes('INSERT INTO customer_memories')) {
        merged = { facts: JSON.parse(params[1]), summary: params[2] };
        return [];
      }
      if (sql.includes('INSERT INTO customer_memory_facts')) {
        if (!semantic.some(row => row.owner_kind === params[0] && row.owner_id === params[1] && row.fact_text === params[2])) {
          semantic.push({ owner_kind: params[0], owner_id: params[1], fact_text: params[2], sequence: semantic.length + 1 });
        }
        return [];
      }
      if (sql.includes('DELETE FROM customer_memory_facts')) {
        assert(sql.includes('ORDER BY last_seen_at DESC LIMIT $3'));
        semantic = semantic.sort((a, b) => b.sequence - a.sequence).slice(0, params[2]);
        return [];
      }
      if (sql.includes('SELECT fact_text FROM customer_memory_facts')) {
        return semantic.slice().sort((a, b) => b.sequence - a.sequence).slice(0, params[3]);
      }
      throw new Error(`Unexpected audit SQL: ${sql}`);
    },
  };
  const memory = new CustomerMemoryService(
    prisma,
    { execute: async () => ({ content: JSON.stringify({ facts: [replacementFact], summary: 'Synthetic corrected preference.' }) }) },
    { generateEmbedding: async () => { throw new Error('Synthetic embedding outage: supported fallback path'); } },
  );
  await memory.extractFromConversation(tenant, schema, '55555555-5555-4555-8555-555555555555', contact);
  assert.deepEqual(merged.facts, [replacementFact]);
  const retrieved = await memory.getMemory(schema, contact, 'Como debo contactar al cliente?', tenant);
  assert(retrieved.facts.includes(oldFact));
  assert(retrieved.facts.includes(replacementFact));
  return {
    embeddingMode: 'Unavailable; documented exact-dedup/recency fallback',
    extractorAcceptedReplacement: merged,
    subsequentlyRetrievedMemory: retrieved,
    obsoleteFactReintroduced: retrieved.facts.includes(oldFact),
  };
}

async function eraseDerivedMemory() {
  const statements = [];
  const compliance = new ComplianceService({
    executeInTenantSchema: async (_schema, sql) => { statements.push(sql); return [{ id: contact }]; },
    auditLog: { create: async () => ({ id: 'synthetic-audit' }) },
  });
  const result = await compliance.eraseContactData(schema, tenant, contact, 'synthetic-reviewer');
  const memoryStatements = statements.filter(sql => /customer_memories|customer_memory_facts/.test(sql));
  assert.equal(memoryStatements.length, 0);
  return {
    returnedErasedTables: result.erasedTables,
    totalStatements: statements.length,
    memoryStatements: memoryStatements.length,
    scope: 'Real erasure method command coverage; no real customer data or deletion.',
  };
}

async function sourceLostOnEmbeddingFailure() {
  const events = [];
  const knowledge = makeKnowledge({
    executeInTenantSchema: async (_schema, sql) => {
      if (sql.startsWith('SELECT id, title, file_type, version')) return [{ id: document, title: 'Synthetic active source', file_type: 'text/plain', version: 1 }];
      if (sql.includes('INSERT INTO knowledge_document_versions')) events.push('saved previous text version');
      else if (sql.includes("status = 'processing'")) events.push('source changed from ready to processing');
      else if (sql.includes('DELETE FROM knowledge_embeddings')) events.push('deleted current embeddings');
      else if (sql.includes("status = 'error'")) events.push('source marked error');
      else throw new Error(`Unexpected audit SQL: ${sql}`);
      return [];
    },
  });
  knowledge.throttle = { getPlanLimit: async () => 100000 };
  knowledge.embedAndStoreChunks = async () => { events.push('replacement embedding failed'); throw new Error('Synthetic embedding failure'); };
  await assert.rejects(() => knowledge.updateDocument(tenant, document, { content: 'Replacement synthetic content' }), /Synthetic embedding failure/);
  assert(events.indexOf('deleted current embeddings') < events.indexOf('replacement embedding failed'));
  assert.equal(events.at(-1), 'source marked error');
  return { events, activeReadyVersionRestoredByMethod: false };
}

async function main() {
  const result = {
    scope: 'Current source; isolated synthetic dependencies; no DB, network or real LLM. Negative audit assertions reproduce gaps.',
    generatedAt: new Date().toISOString(),
    retrieval: await metadataAndThreshold(),
    gapReportContract: await gapContract(),
    memoryCorrection: await forgottenFactReturns(),
    memoryErasure: await eraseDerivedMemory(),
    documentUpdateFailure: await sourceLostOnEmbeddingFailure(),
  };
  const output = path.join(__dirname, 'knowledge-learning-output.json');
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
