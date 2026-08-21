import { AIToolExecutorService } from './ai-tool-executor.service';
import { getToolPolicy, isNonCommittalTool } from './tool-policy-registry';
import { staticToolsForAgentConfig } from './agent-tool-registry';

/**
 * Lo que el agente aprendía y no podía anotar en ningún lado.
 *
 * El CRM tenía dos tools y las dos LEÍAN. El agente descubría en la
 * conversación que el cliente prefiere los martes, que le interesa el plan
 * anual, que ya lo llamaron dos veces — y nada llegaba al CRM. Quedaba en el
 * historial del hilo, que ningún vendedor lee, y el humano que tomaba la
 * conversación después empezaba de cero.
 *
 * Un writer de CRM manejado por un modelo no falla ruidosamente: **ensucia**.
 * Un lead con la etapa equivocada o una etiqueta inventada no se nota hasta que
 * alguien construye un reporte encima. Por eso estas pruebas fijan tanto lo que
 * las tres hacen como lo que **no** pueden hacer.
 */

const schemaName = 'tenant_crm';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const leadId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';

function buildExecutor(rows: any[][] = []) {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const query = jest.fn(async (sql: string, ...params: any[]) => {
        queries.push({ sql, params });
        return rows.shift() ?? [];
    });
    const control = {
        preflight: jest.fn().mockResolvedValue({ decision: 'allow', allowed: true }),
        finish: jest.fn().mockResolvedValue(undefined),
        fail: jest.fn().mockResolvedValue(undefined),
    };
    const stub = {} as any;
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: query } as any,
        stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
        stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
        control as any, stub, stub,
    );
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, queries };
}

describe('el agente ya puede anotar lo que aprende', () => {
    it('la nota se guarda contra el lead y queda atribuida al agente', async () => {
        const { executor, queries } = buildExecutor([[{ id: leadId }], []]);

        const result = await (executor as any).addContactNote(
            schemaName, contactId, conversationId, 'Prefiere los martes por la mañana',
        );

        expect(result).toMatchObject({ success: true });
        const insert = queries.find(q => q.sql.includes('INSERT INTO'))!;
        expect(insert.sql).toContain('notes');
        // Atribuida: el equipo tiene que poder distinguir lo que anotó el
        // agente de lo que escribió una persona.
        expect(insert.sql).toContain("'agent'");
        expect(insert.params).toContain('Prefiere los martes por la mañana');
    });

    it('sin lead no se crea uno: preguntar un horario no mete a nadie al embudo', async () => {
        const { executor, queries } = buildExecutor([[]]);

        const result = await (executor as any).addContactNote(schemaName, contactId, undefined, 'algo');

        expect(result).toMatchObject({ error: 'no_lead' });
        expect(queries.some(q => q.sql.includes('INSERT'))).toBe(false);
    });

    it('una nota vacía o gigante no se guarda', async () => {
        const { executor } = buildExecutor();

        expect(await (executor as any).addContactNote(schemaName, contactId, undefined, ' '))
            .toMatchObject({ error: 'invalid_note' });
        expect(await (executor as any).addContactNote(schemaName, contactId, undefined, 'x'.repeat(1001)))
            .toMatchObject({ error: 'invalid_note' });
    });
});

describe('una etiqueta inventada vuelve inusable el CRM', () => {
    it('sólo se aplica una etiqueta que el negocio ya creó', async () => {
        const { executor, queries } = buildExecutor([[{ id: leadId }], []]);

        const result = await (executor as any).tagContact(schemaName, contactId, 'VIP');

        // El equipo arma un segmento y le faltan la mitad de los contactos
        // porque el agente escribió "VIP" donde ellos usan "vip": por eso NO se
        // crea la etiqueta.
        expect(result).toMatchObject({ error: 'unknown_tag' });
        expect(queries.some(q => q.sql.includes('INSERT INTO'))).toBe(false);
    });

    it('una etiqueta existente se aplica sin duplicar', async () => {
        const { executor, queries } = buildExecutor([[{ id: leadId }], [{ id: 'tag-1' }], []]);

        const result = await (executor as any).tagContact(schemaName, contactId, 'vip');

        expect(result).toMatchObject({ success: true, tag: 'vip' });
        const insert = queries.find(q => q.sql.includes('INSERT INTO'))!;
        expect(insert.sql).toContain('lead_tags');
        expect(insert.sql).toContain('ON CONFLICT DO NOTHING');
    });
});

describe('el interés se registra sin pisar lo que una persona clasificó', () => {
    it('escribe el primario sólo cuando está vacío', async () => {
        const { executor, queries } = buildExecutor([[{ id: leadId }], []]);

        await (executor as any).recordContactInterest(schemaName, contactId, 'plan anual');

        const update = queries.find(q => q.sql.includes('UPDATE'))!;
        // Pisar lo que una persona clasificó es la forma silenciosa de que el
        // equipo deje de confiar en el campo.
        expect(update.sql).toContain("COALESCE(NULLIF(primary_intent, ''), $2)");
        expect(update.sql).toContain('secondary_intent');
    });

    it('un interés ilegible no escribe nada', async () => {
        const { executor, queries } = buildExecutor();

        expect(await (executor as any).recordContactInterest(schemaName, contactId, 'x'))
            .toMatchObject({ error: 'invalid_interest' });
        expect(queries.some(q => q.sql.includes('UPDATE'))).toBe(false);
    });
});

describe('lo que las tres NO pueden hacer', () => {
    it('no existe una tool que mueva la etapa del embudo', () => {
        // El motor de transiciones mira señales y tiene reglas que el dueño
        // configuró. Dejar que el modelo salte por encima lo volvería
        // decorativo.
        const published = staticToolsForAgentConfig({ crm: { enabled: true } })
            .map(t => String(t.name));
        expect(published.some(name => /stage|etapa|pipeline/i.test(name))).toBe(false);
    });

    it('no comprometen al negocio: sobreviven con la escritura bloqueada', () => {
        // Un perfil bloqueado se dedica justamente a capturar y derivar;
        // quitarle la anotación lo dejaría capturando en el aire.
        for (const name of ['add_contact_note', 'tag_contact', 'record_contact_interest']) {
            expect(isNonCommittalTool(name)).toBe(true);
        }
    });

    it('las tres tienen política revisada y no piden confirmación al cliente', () => {
        for (const name of ['add_contact_note', 'tag_contact', 'record_contact_interest']) {
            const policy = getToolPolicy(name);
            expect(policy).toBeDefined();
            // Pedirle al cliente que confirme una nota interna es ruido que
            // además le revela que se está tomando nota de él.
            expect(policy!.confirmation).toBe('not_required');
            expect(policy!.dataClassification).toBe('contact');
        }
    });

    it('se publican con la familia CRM y no sueltas', () => {
        expect(staticToolsForAgentConfig({ crm: { enabled: false } })).toEqual([]);
        const published = staticToolsForAgentConfig({ crm: { enabled: true } })
            .map(t => String(t.name));
        expect(published).toContain('add_contact_note');
        expect(published).toContain('get_customer_context');
    });
});
