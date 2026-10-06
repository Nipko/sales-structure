import { randomUUID } from 'crypto';
import { FaqsService } from '../faqs/faqs.service';
import { PoliciesService } from '../policies/policies.service';
import { N3_DATABASE_URL, CRM_BASE_TABLES, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · knowledge: FAQ search (accents, case, paraphrase, wording), publication,
 * tenant isolation, re-indexing on edit, and policy versions.
 *
 * Real: FaqsService, PoliciesService, executor tools `search_faqs` / `get_policy`,
 * canonical `faqs` / `policies` DDL.
 * Not executable here: anything that needs embeddings or pgvector (semantic
 * paraphrase with no shared word, cross-language retrieval, document import and
 * restore, `[Article: ...]` stripping) because the disposable PostgreSQL has no
 * pgvector and the embedding provider must never be reached.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 knowledge: FAQs and policies', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, faqs: FaqsService, policies: PoliciesService;
    let otherTenantId: string, otherSchema: string;
    const noCache = { get: async () => null, set: async () => undefined, del: async () => undefined, getJson: async () => null, setJson: async () => undefined };

    beforeAll(async () => {
        const holder: { prisma?: any } = {};
        const proxy = new Proxy({}, { get: (_t, key) => holder.prisma[key as any] });
        otherTenantId = randomUUID();
        const tenants = { getSchemaName: async (id: string) => (id === otherTenantId ? otherSchema : h.schema) };
        faqs = new FaqsService(proxy as any, noCache as any, tenants as any, { emit: jest.fn() } as any);
        policies = new PoliciesService(proxy as any, noCache as any, tenants as any, { emit: jest.fn() } as any);
        h = await openLive({
            prefix: 'n3kb',
            executorDeps: { faqsService: faqs, policiesService: policies },
            tables: [...CRM_BASE_TABLES, 'faqs', 'policies'],
        });
        holder.prisma = h.prisma;
        otherSchema = `tenant_n3kb_${randomUUID().replace(/-/g, '')}`;
        await h.client.$executeRawUnsafe(`CREATE SCHEMA "${otherSchema}"`);
        scope = await h.seedAgent();
    });
    afterAll(async () => {
        if (h) {
            if (/^tenant_n3kb_[a-f0-9]{32}$/.test(otherSchema)) await h.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${otherSchema}" CASCADE`);
            await h.close();
        }
    });
    beforeEach(async () => {
        await h.q('TRUNCATE faqs,policies');
        await h.client.$executeRawUnsafe(`TRUNCATE "${otherSchema}"."faqs"`).catch(() => undefined);
    });

    const ask = async (query: string, tenantId?: string) => {
        const C = await seedCustomer(h.q, 'Cliente');
        await h.inbound(C.conversationId, query);
        const result = await h.executor.execute(h.schema, tenantId ?? h.tenantId, C.contactId, 'search_faqs', { query }, C.conversationId, {
            authority: { source: 'turn_contract', allowedTools: ['search_faqs'], resolvedAt: new Date().toISOString() },
            operationalScope: scope, channelType: 'whatsapp',
        });
        return (result.faqs || []) as Array<{ question: string; answer: string }>;
    };

    it.each([
        ['without accents', 'politica de devolucion'],
        ['in capitals with accents', 'POLÍTICA DE DEVOLUCIÓN'],
        ['as a short phrase', 'devolucion'],
    ])('KNW-01: a published FAQ is found when the question is typed %s', async (_label, typed) => {
        await faqs.create(h.tenantId, { question: '¿Cuál es la política de devolución?', answer: 'Aceptamos devoluciones dentro de 15 días.' } as any);
        const found = await ask(typed);
        expect(found.map(f => f.answer)).toEqual(['Aceptamos devoluciones dentro de 15 días.']);
    });

    it('KNW-02: a rephrased question that keeps the topic words finds the FAQ, and an unrelated one finds nothing', async () => {
        await faqs.create(h.tenantId, { question: '¿Cuánto dura la visita guiada?', answer: 'La visita guiada dura 45 minutos.' } as any);
        for (const typed of ['dura la visita guiada', 'Cuanto dura la VISITA guiada']) {
            expect((await ask(typed)).map(f => f.answer)).toEqual(['La visita guiada dura 45 minutos.']);
        }
        expect(await ask('tienen parqueadero para motos')).toEqual([]);
    });

    it('KNW-02: a question about one named product is not answered with the FAQ of a sibling product', async () => {
        await faqs.create(h.tenantId, { question: '¿Qué incluye la visita al Faro Azul?', answer: 'Incluye guía y refrigerio.' } as any);
        const found = await ask('¿Qué incluye la visita al Faro Rojo?');
        expect(found).toEqual([]);
    });

    it('KNW-03: an unpublished FAQ is never returned, and publishing it makes it available', async () => {
        const hidden = await faqs.create(h.tenantId, { question: '¿Aceptan mascotas?', answer: 'Sí, hasta 10 kg.', isPublished: false } as any);
        expect(await ask('aceptan mascotas')).toEqual([]);
        await faqs.update(h.tenantId, hidden.id, { isPublished: true });
        expect((await ask('aceptan mascotas')).map(f => f.answer)).toEqual(['Sí, hasta 10 kg.']);
    });

    it('KNW-03: another tenant\'s FAQ is never returned', async () => {
        await faqs.create(otherTenantId, { question: '¿Aceptan mascotas?', answer: 'Respuesta del OTRO negocio.' } as any);
        expect(await ask('aceptan mascotas')).toEqual([]);
        expect((await ask('aceptan mascotas', otherTenantId)).map(f => f.answer)).toEqual(['Respuesta del OTRO negocio.']);
    });

    it('KNW-04b: after editing only the answer, the FAQ is still found by its question and the new answer is served', async () => {
        const faq = await faqs.create(h.tenantId, { question: '¿Cuál es el horario de atención?', answer: 'Atendemos de lunes a viernes.' } as any);
        await faqs.update(h.tenantId, faq.id, { answer: 'Atendemos todos los días.' });
        expect((await ask('horario de atencion')).map(f => f.answer)).toEqual(['Atendemos todos los días.']);
    });

    it('KNW-04: after editing a FAQ, the old wording stops matching and the new wording matches', async () => {
        const faq = await faqs.create(h.tenantId, { question: '¿Cuál es el horario de atención?', answer: 'Atendemos de lunes a viernes.' } as any);
        await faqs.update(h.tenantId, faq.id, { question: '¿Cuál es la política de devoluciones?', answer: 'Aceptamos devoluciones en 15 días.' });
        expect((await ask('devoluciones')).map(f => f.answer)).toEqual(['Aceptamos devoluciones en 15 días.']);
        expect(await ask('horario')).toEqual([]);
    });

    it('KNW-04: editing only the category re-indexes it without losing the question or the answer', async () => {
        const faq = await faqs.create(h.tenantId, { question: '¿Aceptan mascotas?', answer: 'Sí, pequeñas.', category: 'viejacat' } as any);
        await faqs.update(h.tenantId, faq.id, { category: 'nuevacat' });
        expect((await h.q<any[]>('SELECT search_tsv::text AS tsv FROM faqs'))[0].tsv).toEqual(expect.stringContaining('nuevacat'));
        expect((await h.q<any[]>('SELECT search_tsv::text AS tsv FROM faqs'))[0].tsv).not.toEqual(expect.stringContaining('viejacat'));
        expect((await ask('mascotas')).map(f => f.answer)).toEqual(['Sí, pequeñas.']);
    });

    it.each([['cuanto tiempo dura la visita guiada'], ['duración de la visita guiada?']])(
        'KNW-02b: the rephrasing %p still finds the FAQ that answers it', async typed => {
            await faqs.create(h.tenantId, { question: '¿Cuánto dura la visita guiada?', answer: 'La visita guiada dura 45 minutos.' } as any);
            expect((await ask(typed)).map(f => f.answer)).toEqual(['La visita guiada dura 45 minutos.']);
        });

    it.each([['cuanto cuesta la visita guiada'], ['cuanto dura la visita privada'], ['duración de la entrega']])(
        'KNW-02b: the different question %p does not get the visit-duration FAQ', async typed => {
            await faqs.create(h.tenantId, { question: '¿Cuánto dura la visita guiada?', answer: 'La visita guiada dura 45 minutos.' } as any);
            expect(await ask(typed)).toEqual([]);
        });

    it('KNW-05: the same question twice cannot create two FAQs', async () => {
        await faqs.create(h.tenantId, { question: '¿Aceptan mascotas?', answer: 'Sí.' } as any);
        await expect(faqs.create(h.tenantId, { question: '¿Aceptan mascotas?', answer: 'No.' } as any)).rejects.toThrow(/mismo texto|already/i);
        expect(await h.q('SELECT id FROM faqs')).toHaveLength(1);
    });

    it('KNW-06: get_policy serves only the latest active version, history is kept, and a missing policy is reported, not invented', async () => {
        const C = await seedCustomer(h.q, 'Cliente');
        const call = async (type: string) => {
            await h.inbound(C.conversationId, `politica ${type}`);
            return h.call(C.contactId, C.conversationId, 'get_policy', { type }, scope);
        };
        expect(await call('return')).toMatchObject({ error: expect.stringContaining('No return policy') });
        await policies.upsert(h.tenantId, { type: 'return', title: 'Devoluciones', content: 'Plazo de 15 días.' } as any, 'tester');
        await policies.upsert(h.tenantId, { type: 'return', title: 'Devoluciones', content: 'Plazo de 30 días.' } as any, 'tester');
        expect(await call('return')).toMatchObject({ version: 2, content: 'Plazo de 30 días.' });
        expect(await h.q('SELECT version,is_active FROM policies ORDER BY version')).toEqual([
            { version: 1, is_active: false }, { version: 2, is_active: true }]);
        expect(await call('shipping')).toMatchObject({ error: expect.stringContaining('No shipping policy') });
    });
});
