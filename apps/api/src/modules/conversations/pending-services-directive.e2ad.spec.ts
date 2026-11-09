/**
 * E2ad C01 (dental, 3 de 3 con gpt-4o-mini en E2ab y E2ad): el guard de servicios de plantilla no actuaba nunca en dental. Con la
 * reserva en modo ausente (C16), el motor deja un `directive` en cada turno, también en «¿qué hacen?», y el guard se saltaba
 * cualquier turno con `directive`. Ahora solo deja intacto el texto del motor enviado tal cual como respuesta.
 */
import { ConversationsService } from './conversations.service';

const REPLY = '¡Hola! Somos una clínica dental que ofrece servicios como consulta general, consulta especializada y control y seguimiento de tratamientos odontológicos. ¿Podría decirme si necesita una cita para alguna de estas opciones o si tiene alguna consulta específica?';
const READ = { name: 'list_services', result: { services: [
    { name: 'Consulta general', contentStatus: 'seeded' },
    { name: 'Consulta especializada', contentStatus: 'seeded' },
    { name: 'Control y seguimiento', contentStatus: 'seeded' },
] } };

function service() {
    const s: any = Object.create(ConversationsService.prototype);
    s.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
    s.eventEmitter = { emit: jest.fn() };
    s.recordAgentSignal = jest.fn();
    s.alignReplyLanguage = jest.fn(async (reply: string) => reply);
    s.responseValidator = { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) };
    s.llmRouter = { execute: jest.fn(async () => ({ content: REPLY, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 })) };
    return s;
}
const messages = [{ role: 'user', content: '¿Qué es exactamente lo que hacen?' }];
const guard = (s: any, reply: string, context: any) =>
    s.applyOutputGuardrails(reply, '', messages, [], 'synthetic-tenant', 'synthetic-conversation', [READ], 'es', [], context);

describe('E2ad C01: el guard de servicios de plantilla no depende del directive del motor', () => {
    it('con directive (reserva en modo ausente) la lista de plantilla se dice pendiente', async () => {
        const out = await guard(service(), REPLY, { directive: 'En este momento no se pueden agendar citas por este canal.' });
        expect(out).toContain('Tenga en cuenta que Consulta general, Consulta especializada y Control y seguimiento aún están pendientes de confirmar por el negocio.');
        expect(out.trim().endsWith('?')).toBe(true);
    });

    it('sin directive, igual', async () => {
        expect(await guard(service(), REPLY, {})).toContain('aún están pendientes de confirmar por el negocio');
    });

    it('el texto del motor enviado tal cual como respuesta queda intacto', async () => {
        const engine = 'Ofrecemos consulta general, consulta especializada y control y seguimiento. ¿Cuál prefiere?';
        expect(await guard(service(), engine, { directive: engine, engineReplyText: engine })).toBe(engine);
    });
});
