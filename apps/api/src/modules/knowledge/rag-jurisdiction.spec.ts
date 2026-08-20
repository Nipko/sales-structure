import { KnowledgeService } from './knowledge.service';

/**
 * Una norma colombiana respondía a un cliente mexicano — con cita.
 *
 * El retrieval filtraba únicamente por `status = 'ready'`. El idioma existía,
 * pero solo como boost de ranking, así que dos países que comparten idioma
 * competían por la misma pregunta y ganaba el que estuviera mejor embebido. En
 * salud, finanzas, seguros y legal eso no es un problema de relevancia: es una
 * respuesta equivocada con una fuente adjunta, que es peor que no responder.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';

/** Las dos consultas de recuperación; el servicio emite otras (logging) que no están bajo prueba. */
const retrievalSqls = (capture: { sqls: string[] }) =>
    capture.sqls.filter(sql => /FROM knowledge_embeddings/.test(sql));

const retrievalParams = (capture: { sqls: string[]; params: any[][] }) =>
    capture.params.filter((_p, i) => /FROM knowledge_embeddings/.test(capture.sqls[i]));

function buildService(capture: { sqls: string[]; params: any[][] }) {
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params?: any[]) => {
        capture.sqls.push(sql);
        capture.params.push(params || []);
        return [];
    });
    const stub = () => ({}) as any;
    const service = new KnowledgeService(
        {
            executeInTenantSchema,
            tenant: { findUnique: jest.fn().mockResolvedValue({ schemaName: 'tenant_kb' }) },
        } as any,
        stub(), stub(), stub(), stub(), stub(),
    );
    (service as any).tenantSchema = jest.fn().mockResolvedValue('tenant_kb');
    (service as any).ensureKbSearchVector = jest.fn().mockResolvedValue(undefined);
    (service as any).embedQueryCached = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    jest.spyOn((service as any).logger ?? { warn() {} }, 'warn').mockImplementation(() => undefined);
    return service;
}

describe('el filtro jurisdiccional es duro para fuentes reguladas', () => {
    it('la consulta lleva la jurisdicción como parámetro, no interpolada', async () => {
        const capture = { sqls: [] as string[], params: [] as any[][] };
        const service = buildService(capture);

        await service.searchRelevant(tenantId, 'devoluciones', 5, { jurisdiction: 'MX' });

        expect(retrievalSqls(capture).length).toBe(2);
        for (const sql of retrievalSqls(capture)) {
            expect(sql).toContain('is_regulated');
            // La jurisdicción viaja como parámetro: interpolarla sería inyección
            // y además rompería el plan de consulta.
            expect(sql).not.toContain("'MX'");
        }
        expect(retrievalParams(capture).every(p => p.includes('MX'))).toBe(true);
    });

    it('un documento no regulado nunca se excluye por país', async () => {
        const capture = { sqls: [] as string[], params: [] as any[][] };
        const service = buildService(capture);

        await service.searchRelevant(tenantId, 'horario', 5, { jurisdiction: 'MX' });

        // La condición deja pasar todo lo que no está marcado como regulado:
        // la mayor parte de una base de conocimiento es material propio del
        // negocio, que aplica donde sea que opere.
        for (const sql of retrievalSqls(capture)) {
            expect(sql).toMatch(/COALESCE\(kd\.is_regulated, false\) = false/);
        }
    });

    it('una fuente regulada exige país coincidente y vigencia', async () => {
        const capture = { sqls: [] as string[], params: [] as any[][] };
        const service = buildService(capture);

        await service.searchRelevant(tenantId, 'norma', 5, { jurisdiction: 'CO' });

        for (const sql of retrievalSqls(capture)) {
            expect(sql).toMatch(/kd\.jurisdiction IS NULL OR kd\.jurisdiction = /);
            // Una norma vencida citada como vigente es su propia clase de
            // respuesta equivocada.
            expect(sql).toMatch(/kd\.valid_from IS NULL OR kd\.valid_from <= CURRENT_DATE/);
            expect(sql).toMatch(/kd\.valid_to IS NULL OR kd\.valid_to >= CURRENT_DATE/);
        }
    });

    it('sin jurisdicción conocida ninguna fuente regulada se devuelve', async () => {
        const capture = { sqls: [] as string[], params: [] as any[][] };
        const service = buildService(capture);

        await service.searchRelevant(tenantId, 'norma', 5, {});

        // El parámetro va NULL, y la condición exige que no sea NULL para
        // habilitar la rama regulada: responder sobre normas sin saber de qué
        // país es exactamente lo que este filtro existe para impedir.
        for (const sql of retrievalSqls(capture)) {
            expect(sql).toMatch(/IS NOT NULL/);
        }
        expect(retrievalParams(capture).every(p => p.includes(null))).toBe(true);
    });

    it('devuelve autoridad y vigencia para que la respuesta sea auditable', async () => {
        const capture = { sqls: [] as string[], params: [] as any[][] };
        const service = buildService(capture);

        await service.searchRelevant(tenantId, 'norma', 5, { jurisdiction: 'CO' });

        for (const sql of retrievalSqls(capture)) {
            expect(sql).toContain('kd.authority AS doc_authority');
            expect(sql).toContain('kd.jurisdiction AS doc_jurisdiction');
            expect(sql).toContain('kd.valid_from AS doc_valid_from');
        }
    });

    it('normaliza el código de país a mayúsculas', async () => {
        const capture = { sqls: [] as string[], params: [] as any[][] };
        const service = buildService(capture);

        await service.searchRelevant(tenantId, 'norma', 5, { jurisdiction: ' mx ' });

        expect(retrievalParams(capture).every(p => p.includes('MX'))).toBe(true);
    });
});
