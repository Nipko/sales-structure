import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';
import { FaqsService } from './faqs.service';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

/**
 * Production F4300-21 against the real `plainto_tsquery`/`to_tsquery` SQL: «cuánto cobran de comisión por vender mi
 * apartamento?» returned 0 FAQs although «¿Cuánto cobran de comisión / honorarios?» is published. The FAQs are the
 * production tenant's, created through the service so `search_tsv` is indexed exactly as in production.
 */
(connection ? describe : describe.skip)('FAQ topic recall with actual PostgreSQL (F4300-21)', () => {
    const schema = `tenant_faqtopic_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    let client: PrismaClient;
    let service: FaqsService;
    const search = async (query: string) => (await service.search(tenantId, query, 5)).map(f => f.question);

    beforeAll(async () => {
        if (!isDisposableDatabaseUrl(new URL(connection!))) throw new Error('disposable_database_required');
        client = new PrismaClient({ datasources: { db: { url: connection! } } });
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        service = new FaqsService(client as any, { del: async () => 0 } as any, {
            getSchemaName: async (id: string) => { if (id !== tenantId) throw new Error('synthetic scope rejected'); return schema; },
        } as any);
        const faqs: Array<[string, string]> = [
            ['¿Qué propiedades tienen disponibles?', 'Tenemos opciones en venta y arriendo. Cuéntame tu presupuesto, zona de interés y tipo de inmueble y te muestro las que mejor encajan.'],
            ['¿Cuál es la comisión?', 'La comisión depende del tipo de operación. Te confirmo la cifra exacta antes de avanzar; si quieres, agendamos una reunión para revisarla con calma.'],
            ['¿Ofrecen financiación?', 'Podemos orientarte sobre opciones de crédito hipotecario y contarte con qué entidades trabajamos. Agenda una asesoría y lo revisamos juntos.'],
            ['¿Cómo agendo una visita?', 'Puedo agendar una visita para ti ahora mismo. Dime cuál propiedad te interesa y tus horarios disponibles.'],
            ['¿Qué documentos necesito?', 'Depende de si compras o arriendas y de la entidad que participe. Cuéntame cuál es tu caso y un asesor te pasa la lista exacta de documentos.'],
            ['¿Tienen opciones con financiación / crédito hipotecario?', 'La financiación depende de cada propiedad y de tu perfil.'],
            ['¿Cómo agendo una visita a la propiedad?', 'Te muestro las propiedades disponibles según tu interés y agendamos visita con el asesor de zona.'],
            ['¿Cuánto cobran de comisión / honorarios?', 'Los honorarios dependen de si es arriendo o venta y del inmueble. Te los confirma el asesor sobre la propiedad concreta que te interese, antes de cualquier compromiso.'],
            ['¿Qué documentos necesito para arrendar / comprar?', 'Arriendo: cédula, certificado laboral, extractos bancarios y codeudor. Compra: capacidad crediticia y separación.'],
            ['¿La administración / cuota de condominio está incluida en el precio?', 'En arriendo: la administración generalmente NO está incluida y se paga aparte.'],
        ];
        for (const [question, answer] of faqs) await service.create(tenantId, { question, answer, category: 'general' });
    });

    afterAll(async () => {
        if (!client) return;
        if (!/^tenant_faqtopic_[a-f0-9]{32}$/.test(schema)) throw new Error('unsafe_cleanup_scope');
        await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.$disconnect();
    });

    jest.setTimeout(45000);

    it('returns the commission FAQ for the production message', async () => {
        expect(await search('cuánto cobran de comisión por vender mi apartamento?')).toEqual(['¿Cuánto cobran de comisión / honorarios?']);
        expect(await search('cuanto cobran de comision por vender mi apartamento')).toEqual(['¿Cuánto cobran de comisión / honorarios?']);
    });

    it('returns nothing when the message shares only words that ask', async () => {
        expect(await search('¿cuánto cobran por pintar la fachada de mi casa?')).toEqual([]);
    });

    it('keeps the strict search first', async () => {
        expect(await search('¿Cuál es la comisión?')).toEqual(['¿Cuál es la comisión?']);
    });
});
