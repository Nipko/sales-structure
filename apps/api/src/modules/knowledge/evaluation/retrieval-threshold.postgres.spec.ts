import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KnowledgeService } from '../knowledge.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../../common/types/execution-context';
import { ensureSyntheticGlobalTables } from '../../../common/__fixtures__/synthetic-global-tables';
import { DISPOSABLE_KNOWLEDGE_DATABASE, isDisposableDatabaseUrl } from '../../../common/__fixtures__/disposable-database';
import { deterministicEmbedding, embeddingLiteral } from './retrieval-embedding';

/**
 * `similarityThreshold` has to actually be a threshold.
 *
 * The hybrid retriever keeps a chunk that clears the relevance bar OR that is a
 * keyword match, and the exception is right: an exact term the embedding scores
 * badly — a product code, a plan name, a part number — should not be dropped
 * because a vector shrugged at it. What went wrong was the definition of
 * "keyword match".
 *
 * `keywordHit` is a graded, deliberately generous SCORING signal: it turns true
 * when any single query token longer than three characters appears as a
 * substring of the chunk. Wired into the admission filter, it meant one shared
 * common word let a chunk through at ANY threshold. A caller asking for 0.35 —
 * which is what the live conversation path asks for — got back whatever
 * happened to share a word with the customer's question.
 *
 * The measured cost was abstention. In the labelled evaluation, abstention
 * accuracy climbed to 0.6 and then went FLAT: 0.25, 0.35, 0.45, 0.55, 0.65, all
 * 0.6. A threshold that changes nothing above a point is not a threshold. The
 * corpus could not answer, retrieval returned something anyway, and a confident
 * reply gets built on whatever came back.
 *
 * This suite pins both halves of the fix, because a fix that only closes the
 * hole would silently delete the exact-term recall the exception was written
 * for.
 */

const url = process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;

(url ? describe : describe.skip)('the similarity threshold, and what may bypass it', () => {
    jest.setTimeout(180_000);

    const tenantId = randomUUID();
    const schema = `tenant_ragcut_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient;
    let prisma: PrismaService;
    let knowledge: KnowledgeService;

    const local = (statement: string, params: any[] = []) =>
        prisma.executeInTenantSchema<any[]>(schema, statement, params);

    const search = (query: string, threshold: number) => knowledge.searchRelevant(tenantId, query, 10, {
        executionContext: AGENT_TEST_EXECUTION_CONTEXT,
        similarityThreshold: threshold, language: 'es', audience: 'customer',
    });

    const seed = async (title: string, text: string) => {
        const [row] = await local(
            `INSERT INTO knowledge_documents (title, content_text, status, language, chunk_count)
             VALUES ($1,$2,'ready','es',1) RETURNING id`, [title, text]);
        await local(
            `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text, embedding, search_tsv)
             VALUES ($1::uuid,0,$2,$3::vector, to_tsvector('simple',$2))`,
            [row.id, text, embeddingLiteral(deterministicEmbedding(text))]);
        return String(row.id);
    };

    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
            || !isDisposableDatabaseUrl(parsed, DISPOSABLE_KNOWLEDGE_DATABASE)) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: url });
        prisma = Object.assign(Object.create(PrismaService.prototype), {
            tenant: client.tenant,
            $transaction: client.$transaction.bind(client),
            $queryRawUnsafe: client.$queryRawUnsafe.bind(client),
            $executeRawUnsafe: client.$executeRawUnsafe.bind(client),
        });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        const ddl = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8')
            .replaceAll('{{SCHEMA_NAME}}', schema);
        for (const statement of (prisma as any).splitSqlStatements(ddl)) {
            if (/^(CREATE TABLE IF NOT EXISTS|ALTER TABLE|CREATE INDEX IF NOT EXISTS)\s+.*"(knowledge_documents|knowledge_embeddings)"/i
                .test(statement)) await client.$executeRawUnsafe(statement);
        }
        await client.$executeRawUnsafe(`ALTER TABLE "${schema}".knowledge_embeddings ADD COLUMN IF NOT EXISTS search_tsv tsvector`);
        const cache = { get: jest.fn(async () => null), set: jest.fn(async () => undefined), tenantKey: jest.fn(() => 'evaluation') };
        knowledge = new KnowledgeService(prisma, cache as any, {} as any, {} as any, {} as any, {} as any);
        jest.spyOn(knowledge, 'generateEmbedding').mockImplementation(async (text: string) => deterministicEmbedding(text));
    }, 120_000);

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_ragcut_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_test_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(() => local('TRUNCATE knowledge_documents, knowledge_embeddings CASCADE'));

    it('does not let one shared word carry a chunk past any cut', async () => {
        // The word is "habitaciones". It is in the question and in a document
        // about something else entirely, and it is the only thing they share.
        await seed('Desayuno', 'El desayuno se sirve de 7 a 10 para los huéspedes de todas las habitaciones.');
        const generous = await search('¿Cuánto cuestan las habitaciones?', 0.05);
        expect(generous.length).toBeGreaterThan(0);

        // At a cut the chunk does not clear, it must be gone. Before the fix it
        // came back at every threshold up to and including 0.99, because a
        // graded substring boost was being read as an admission ticket.
        const strict = await search('¿Cuánto cuestan las habitaciones?', 0.9);
        expect(strict).toEqual([]);
    });

    it('still admits the exact term the embedding scored badly', async () => {
        // This is what the exception was written for: a code the vector has no
        // opinion about, in a chunk that says almost nothing else.
        await seed('Repuesto', 'El repuesto XR-4417B se pide con 15 días de anticipación.');
        await seed('Ruido', 'Los electrodomésticos hacen ruido cuando el motor está desbalanceado por el uso continuo.');
        const hits = await search('XR-4417B', 0.9);
        // A full tsquery match — `plainto_tsquery` ANDs every lexeme, so the
        // chunk contains all of them — is admitted above the cut, and the chunk
        // that merely shares vocabulary is not.
        expect(hits.map(hit => hit.title)).toEqual(['Repuesto']);
    });

    it('keeps the graded signal for scoring, where it was always useful', async () => {
        await seed('Cancelación', 'Cancelás sin costo hasta 48 horas antes del check-in.');
        const [hit] = await search('cancelación sin costo', 0.05);
        // `keywordHit` stays true on a partial overlap. It never stopped being a
        // good scoring nudge; it just stopped being permission to skip the cut.
        expect(hit.keywordHit).toBe(true);
        expect(hit.score).toBeGreaterThan(hit.similarity);
    });

    it('makes the cut monotonic, which is what makes it a threshold at all', async () => {
        await seed('Mascotas', 'No se aceptan mascotas en las habitaciones.');
        await seed('Piscina', 'La piscina abre de 8 a 20 y los menores entran acompañados.');
        await seed('Estacionamiento', 'El estacionamiento cubierto tiene veinte lugares.');
        const counts: number[] = [];
        for (const threshold of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
            counts.push((await search('¿Aceptan mascotas en las habitaciones?', threshold)).length);
        }
        // Never more results for a stricter cut. Before the fix this line was
        // flat — every threshold returned the same set — which is the shape of a
        // knob that is not connected to anything.
        for (let index = 1; index < counts.length; index += 1) {
            expect({ counts, stricterReturnedMore: counts[index] > counts[index - 1] })
                .toEqual({ counts, stricterReturnedMore: false });
        }
        expect(counts[0]).toBeGreaterThan(counts[counts.length - 1]);
    });
});
