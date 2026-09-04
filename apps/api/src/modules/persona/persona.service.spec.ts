import { BadRequestException } from '@nestjs/common';
import { PersonaService } from './persona.service';

/**
 * Dos defectos que se veían como éxitos:
 *
 * 1. `updateAgent` escribía `config_json` sin mirarlo. Se podía borrar el
 *    nombre, el mensaje de fallback, todas las reglas y todos los motivos de
 *    escalado, recibir "guardado" y enterarse después por un bloqueo crítico.
 * 2. `tpl_faq` encendía `rag`, así que el check crítico `rag_knowledge` marcaba
 *    en rojo a un tenant cuyas preguntas frecuentes funcionaban perfecto.
 */
describe('PersonaService — agente válido antes de escribir', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const agentId = '22222222-2222-4222-8222-222222222222';

    const validConfig = () => ({
        persona: {
            name: 'Sofía',
            role: 'Asistente de recepción',
            greeting: 'Hola, soy Sofía. ¿En qué te ayudo?',
            fallbackMessage: 'Te paso con una persona del equipo.',
        },
        behavior: {
            rules: ['Confirmar los datos antes de agendar'],
            handoffTriggers: ['El cliente pide hablar con un humano'],
            forbiddenTopics: [],
            requiredFields: {},
        },
    });

    function makeService(priorConfig: any = validConfig()) {
        const statements: string[] = [];
        const prisma = {
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                statements.push(sql);
                if (sql.includes('SELECT channel_bindings')) {
                    return [{ channel_bindings: [], config_json: priorConfig }];
                }
                if (sql.includes('RETURNING *')) return [{ id: agentId, name: 'Sofía' }];
                return [];
            }),
            $executeRawUnsafe: jest.fn(async () => 1),
            channelAccount: { findMany: jest.fn(async () => []) },
        };
        const redis = { del: jest.fn(async () => undefined) };
        const tenantsService = { getSchemaName: jest.fn(async () => 'tenant_test') };
        const eventEmitter = { emit: jest.fn() };
        const service = new PersonaService(
            prisma as any,
            redis as any,
            tenantsService as any,
            {} as any,
            eventEmitter as any,
        );
        // La DDL perezosa no es lo que se está probando.
        (service as any).initializedTenants.add(tenantId);
        return { service, prisma, statements };
    }

    const writes = (statements: string[]) => statements.filter((sql) => /^\s*UPDATE/i.test(sql));

    async function expectAgentInvalid(promise: Promise<unknown>, fields: string[]) {
        await expect(promise).rejects.toBeInstanceOf(BadRequestException);
        await promise.catch((error: BadRequestException) => {
            expect(error.getResponse()).toMatchObject({ error: 'agent_invalid' });
            expect((error.getResponse() as any).fields).toEqual(expect.arrayContaining(fields));
        });
    }

    it('rechaza el guardado que vacía identidad, fallback, reglas y escalado — y no escribe nada', async () => {
        const { service, statements } = makeService();
        const emptied = {
            persona: { name: '   ', role: '', greeting: 'Hola', fallbackMessage: '' },
            behavior: { rules: [], handoffTriggers: [], forbiddenTopics: [], requiredFields: {} },
        };

        await expectAgentInvalid(
            service.updateAgent(tenantId, agentId, { configJson: emptied }),
            ['persona.name', 'persona.role', 'persona.fallbackMessage', 'behavior.rules', 'behavior.handoffTriggers'],
        );
        expect(writes(statements)).toHaveLength(0);
    });

    it('rechaza una lista de reglas que solo tiene entradas en blanco', async () => {
        const { service } = makeService();
        const config = validConfig();
        config.behavior.rules = ['   ', ''];

        await expectAgentInvalid(
            service.updateAgent(tenantId, agentId, { configJson: config }),
            ['behavior.rules'],
        );
    });

    it('guarda un agente completo', async () => {
        const { service, statements } = makeService();

        await expect(service.updateAgent(tenantId, agentId, { configJson: validConfig() }))
            .resolves.toMatchObject({ id: agentId });
        expect(writes(statements).length).toBeGreaterThan(0);
    });

    it('en modo prompt exige el prompt propio en vez de reglas y motivos de escalado', async () => {
        const { service } = makeService();
        const promptAgent = {
            editorMode: 'prompt',
            persona: { name: 'Sofía', role: 'Asistente', fallbackMessage: 'Te paso con alguien.' },
            behavior: { rules: [], handoffTriggers: [] },
        };

        await expectAgentInvalid(
            service.updateAgent(tenantId, agentId, { configJson: { ...promptAgent, customPrompt: '  ' } }),
            ['customPrompt'],
        );

        await expect(service.updateAgent(tenantId, agentId, {
            configJson: { ...promptAgent, customPrompt: 'Atendé como recepcionista de la clínica.' },
        })).resolves.toMatchObject({ id: agentId });
    });

    it('acepta el borrador parcial del asistente (solo los campos que ya se escribieron)', async () => {
        const { service } = makeService();

        await expect(service.updateAgent(tenantId, agentId, {
            configJson: { persona: { name: 'Sofía', greeting: 'Hola, soy Sofía' } },
            partialDraft: true,
        })).resolves.toMatchObject({ id: agentId });
    });

    it('en el borrador sigue rechazando un campo presente pero vacío', async () => {
        const { service } = makeService();

        await expectAgentInvalid(
            service.updateAgent(tenantId, agentId, {
                configJson: { persona: { name: '', greeting: 'Hola' } },
                partialDraft: true,
            }),
            ['persona.name'],
        );
    });

    it('rechaza vaciar el nombre de la columna que muestra el panel', async () => {
        const { service, statements } = makeService();

        await expectAgentInvalid(service.updateAgent(tenantId, agentId, { name: '  ' }), ['persona.name']);
        expect(writes(statements)).toHaveLength(0);
    });

    it('no valida la configuración en un cambio de estado (activar/desactivar)', async () => {
        // Un agente heredado con la configuración incompleta tiene que poder
        // apagarse; si no, el único arreglo disponible queda bloqueado.
        const { service } = makeService({ persona: { name: 'Viejo' }, behavior: {} });

        await expect(service.updateAgent(tenantId, agentId, { isActive: false }))
            .resolves.toMatchObject({ id: agentId });
    });
});

describe('PersonaService — plantilla de preguntas frecuentes', () => {
    const service = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);

    it.each(['es', 'en'])('en %s enciende FAQs y deja RAG apagado', (lang) => {
        const template = service.getBuiltinTemplates(lang).find((t: any) => t.id === 'tpl_faq');

        expect(template).toBeDefined();
        // Con `rag.enabled === true` el check crítico `rag_knowledge` exige
        // fragmentos vectorizados que este tenant nunca prometió tener.
        expect(template.config_json.rag.enabled).toBe(false);
        expect(template.config_json.tools.faqs.enabled).toBe(true);
    });
});
