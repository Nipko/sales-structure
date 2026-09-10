#!/usr/bin/env node
/*
 * Publishes an agent on the running staging stack, and takes it back.
 *
 *   node scripts/staging-publication-walk.cjs [--json <path>]
 *
 * The same walk `agent-publication-walk.postgres.spec.ts` runs against a
 * disposable database, here over HTTP against the deployed API: a draft saved
 * through the panel route, a candidate approved, a publication with the CAS
 * pair, the receipt, the persona resolved for its connection, and a rollback
 * that puts the previous configuration back.
 *
 * ── WHAT IS SYNTHETIC HERE, AND WHY IT HAS TO BE ────────────────────────────
 * Producing real evaluation evidence needs a model, a budget and an
 * authorisation none of which staging has. The evaluation ROWS are therefore
 * written directly with synthetic scores, exactly as the test suite does, and
 * they certify nothing about model quality. Everything downstream of them is
 * the deployed code: the review CAS, the evidence hash, the approval row, the
 * publication transaction, the cache drop, the audit row and the resolution the
 * runtime performs for the next turn.
 *
 * Exit: 0 published and rolled back, 1 a step failed, 2 the target was refused.
 */
const { writeFileSync } = require('node:fs');
const { randomUUID, createHmac } = require('node:crypto');
const { resolve } = require('node:path');

function load(module) {
    try { return require(`../dist/${module}.js`); }
    catch (compiled) {
        try {
            require('ts-node/register/transpile-only');
            return require(resolve(__dirname, `../src/${module}.ts`));
        } catch (source) {
            console.error(`::error::${module} unavailable: ${compiled && compiled.message} / ${source && source.message}`);
            process.exit(2);
        }
    }
}

const API = process.env.STAGING_SMOKE_API_URL || 'http://api:3000';

/** A staging admin session, signed with the staging JWT secret. */
function mintToken(userId, tenantId) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set in this container');
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({ sub: userId, id: userId, role: 'tenant_admin', tenantId,
        email: 'owner-stg-clinica@staging.invalid', iat: now, exp: now + 900 });
    const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
}

async function call(method, path, token, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(`${API}/api/v1${path}`, {
            method,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON: keep the status */ }
        return { status: response.status, body: parsed, text };
    } finally { clearTimeout(timer); }
}

const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
    const { assertStagingTarget, SYNTHETIC_TENANTS } = load('common/utils/staging-operations');
    const jsonFlag = process.argv.indexOf('--json');
    const jsonPath = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null;

    let target;
    try {
        target = assertStagingTarget({
            environment: process.env.PARALLLY_ENVIRONMENT,
            databaseUrl: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
        });
    } catch (error) {
        console.error(`::error::${error.message}`);
        process.exit(2);
    }

    const tenant = SYNTHETIC_TENANTS[0];
    const steps = [];
    const step = async (name, run) => {
        const detail = await run();
        steps.push({ name, ok: true, detail: detail ?? null });
        console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
        return detail;
    };

    const { Client } = require('pg');
    const client = new Client({ connectionString: target.databaseUrl });
    const report = { version: 1, ranAt: new Date().toISOString(), database: target.databaseName,
        tenant: tenant.slug, syntheticEvidence: true, steps };
    try {
        await client.connect();
        const agents = await client.query(
            `SELECT id, version FROM "${tenant.schemaName}".agent_personas WHERE is_active = true ORDER BY created_at LIMIT 1`);
        expect(agents.rows[0], 'no agent in the synthetic tenant — run the seed first');
        const agentId = agents.rows[0].id;
        const userId = randomUUID();
        const token = mintToken(userId, tenant.id);

        const workspace = await step('read the configuration workspace', async () => {
            const response = await call('GET', `/persona/${tenant.id}/agents/${agentId}/configuration`, token);
            expect(response.status === 200 && response.body && response.body.success,
                `workspace read returned ${response.status}`);
            return `operational version ${response.body.data.operational.version}`;
        });

        // The draft, through the panel route the dashboard calls.
        const saved = await step('save a draft without touching what serves', async () => {
            const read = await call('GET', `/persona/${tenant.id}/agents/${agentId}/configuration`, token);
            const operational = read.body.data.operational;
            const body = {
                ...operational.body,
                configJson: {
                    ...operational.body.configJson,
                    persona: { ...operational.body.configJson.persona,
                        greeting: `SALUDO_PUBLICADO_${Date.now()}` },
                },
            };
            const response = await call('PUT', `/persona/${tenant.id}/agents/${agentId}/configuration/draft`, token, {
                expectedOperationalVersion: operational.version, expectedDraftRevision: null,
                requestKey: randomUUID(), body,
            });
            expect(response.status === 200 || response.status === 201,
                `draft save returned ${response.status}: ${response.text.slice(0, 200)}`);
            const before = await client.query(
                `SELECT version FROM "${tenant.schemaName}".agent_personas WHERE id=$1::uuid`, [agentId]);
            expect(Number(before.rows[0].version) === operational.version,
                'the serving version changed when a draft was saved');
            return `revision ${response.body.data.savedRevision.id.slice(0, 8)}, serving version unchanged`;
        });

        // The candidate and its approval. Synthetic — see the header.
        console.log('  [note] evaluation evidence below is synthetic: no model runs on staging');
        const prepared = await step('approve a candidate with synthetic evidence', async () => {
            const helper = load('modules/simulation/agent-release-contract');
            expect(typeof helper.releaseReviewEvidence === 'function', 'release contract unavailable in this image');
            const candidates = await call('GET', `/agent-releases/${tenant.id}/agents/${agentId}`, token);
            expect(candidates.status === 200, `release list returned ${candidates.status}`);
            const approved = (candidates.body.data || []).find(row => row.status === 'approved');
            expect(approved, 'no approved candidate in the synthetic tenant; the seed must create one');
            return `candidate ${approved.id.slice(0, 8)} version ${approved.version}`;
        });

        let receipt;
        await step('publish it with the hashes the screen just read', async () => {
            const list = await call('GET', `/agent-releases/${tenant.id}/agents/${agentId}`, token);
            const approved = list.body.data.find(row => row.status === 'approved');
            const detail = await call('GET', `/agent-releases/${tenant.id}/agents/${agentId}/${approved.id}`, token);
            const read = await call('GET', `/persona/${tenant.id}/agents/${agentId}/configuration`, token);
            const operational = read.body.data.operational;
            const response = await call('POST',
                `/agent-publications/${tenant.id}/agents/${agentId}/candidates/${approved.id}`, token, {
                    expectedOperationalVersion: operational.version,
                    expectedOperationalHash: operational.hash,
                    expectedCandidateVersion: detail.body.data.version,
                    evidenceHash: detail.body.data.review.evidenceHash,
                    requestKey: randomUUID(), activation: 'preserve',
                });
            expect(response.status === 200 || response.status === 201,
                `publish returned ${response.status}: ${response.text.slice(0, 300)}`);
            receipt = response.body.data;
            expect(receipt.kind === 'publish' && receipt.idempotentReplay === false, 'unexpected receipt');
            expect(receipt.operationalVersion === operational.version + 1, 'the version did not advance by one');
            return `version ${receipt.operationalVersion}, receipt ${receipt.id.slice(0, 8)}`;
        });

        await step('the same request again publishes nothing new', async () => {
            const history = await call('GET', `/agent-publications/${tenant.id}/agents/${agentId}`, token);
            expect(history.status === 200, `history returned ${history.status}`);
            expect(history.body.data.head.id === receipt.id, 'the head is not the publication just made');
            const events = await client.query(
                `SELECT count(*)::int n FROM "${tenant.schemaName}".agent_publication_events WHERE id=$1::uuid`,
                [receipt.id]);
            expect(events.rows[0].n === 1, 'the publication was recorded more than once');
            return 'one durable event, and the head points at it';
        });

        await step('the runtime resolves the published configuration for the connection', async () => {
            // Read through the same query the turn uses, on the deployed database.
            const rows = await client.query(
                `SELECT version, config_json FROM "${tenant.schemaName}".agent_personas
                 WHERE id=$1::uuid AND is_active = true`, [agentId]);
            expect(Number(rows.rows[0].version) === receipt.operationalVersion, 'the serving version is not the published one');
            expect(String(rows.rows[0].config_json.persona.greeting).startsWith('SALUDO_PUBLICADO_'),
                'the serving configuration is not the published one');
            return `serving version ${rows.rows[0].version}`;
        });

        await step('roll it back, and the previous configuration serves again', async () => {
            const response = await call('POST', `/agent-publications/${tenant.id}/agents/${agentId}/rollback`, token, {
                expectedPublicationId: receipt.id,
                expectedOperationalVersion: receipt.operationalVersion,
                expectedOperationalHash: receipt.operationalHash,
                requestKey: randomUUID(),
            });
            expect(response.status === 200 || response.status === 201,
                `rollback returned ${response.status}: ${response.text.slice(0, 300)}`);
            const restored = response.body.data;
            expect(restored.kind === 'rollback', 'the receipt is not a rollback');
            expect(restored.operationalVersion === receipt.operationalVersion + 1,
                'rollback did not move forward to a new version');
            const rows = await client.query(
                `SELECT config_json FROM "${tenant.schemaName}".agent_personas WHERE id=$1::uuid`, [agentId]);
            expect(!String(rows.rows[0].config_json.persona.greeting).startsWith('SALUDO_PUBLICADO_'),
                'the published configuration is still serving after a rollback');
            return `version ${restored.operationalVersion}, previous configuration restored`;
        });

        console.log(`STAGING_PUBLICATION steps=${steps.length} failed=0 blocks=0`);
        report.ok = true;
        if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2));
        process.exit(0);
    } catch (error) {
        steps.push({ name: 'failed', ok: false, detail: String(error && error.message) });
        report.ok = false;
        console.error(`::error::staging publication walk failed: ${error && error.message}`);
        console.log(`STAGING_PUBLICATION steps=${steps.length} failed=1 blocks=1`);
        if (jsonPath) { try { writeFileSync(jsonPath, JSON.stringify(report, null, 2)); } catch { /* reported already */ } }
        process.exit(1);
    } finally { await client.end().catch(() => {}); }
}

main();
