import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TurnContext } from '@parallext/shared';
import { PromptAssemblerService } from './prompt-assembler.service';

/**
 * El bloque <recent_actions> no se emitió NUNCA en producción.
 *
 * El recuerdo de lo que hicieron las herramientas se escribía bien en la base y
 * se leía bien de la base — y después se le colgaba a `turnContext` TREINTA
 * líneas DESPUÉS de que `assembleWithCacheBoundary` ya había devuelto el string
 * del prompt. Se le adjuntaba el recuerdo a un objeto ya consumido.
 *
 * Mientras tanto la regla 18 del contrato le ordenaba al modelo "reusá el
 * identificador que aparece en <recent_actions>". Le pedíamos reusar un dato de
 * un bloque inexistente: el modelo inventaba el UUID, y la reserva fallaba con
 * "Property not found" DESPUÉS de que el cliente había dicho que sí.
 *
 * Ningún test cubría el bloque, así que compiló, pasó 2.100 tests y se desplegó
 * muerto. Estos son los dos que lo habrían atrapado: uno prueba que el bloque se
 * rinde, y el otro que quien lo llena lo hace ANTES de armar el prompt.
 */

const BASE_TURN: TurnContext = {
    language: 'es',
    timezone: 'America/Bogota',
    now: '2026-08-19T12:00:00.000Z',
    upcomingDays: [],
    businessHoursStatus: 'open',
};

const CONFIG = { tools: {} } as any;

describe('<recent_actions> llega al prompt', () => {
    const personaService = { buildSystemPrompt: jest.fn(() => '<persona><name>Laura</name></persona>') };
    const service = new PromptAssemblerService(personaService as any);

    const ACTIONS = [
        {
            tool: 'list_properties',
            ok: true,
            facts: '- id: a36c1e0c-c71b-4837-8f30-048e94bba421\n- name: Amazon Minimalist',
        },
        { tool: 'send_property_image', ok: false },
    ];

    it('rinde la acción, su resultado y los identificadores que devolvió', () => {
        const turn = { ...BASE_TURN, recentActions: ACTIONS } as any;

        const prompt = service.assembleWithCacheBoundary(CONFIG, turn).systemPrompt;

        expect(prompt).toContain('<recent_actions>');
        expect(prompt).toContain('tool="list_properties"');
        expect(prompt).toContain('outcome="succeeded"');
        expect(prompt).toContain('outcome="failed"');
        // El identificador es el punto entero del bloque: sin él, la regla 18
        // le pide al modelo reusar algo que no tiene.
        expect(prompt).toContain('a36c1e0c-c71b-4837-8f30-048e94bba421');
    });

    it('no ensucia el prompt cuando no hay acciones previas', () => {
        const prompt = service.assembleWithCacheBoundary(CONFIG, { ...BASE_TURN } as any).systemPrompt;
        expect(prompt).not.toContain('<recent_actions>');
    });

    it('el bloque queda FUERA del prefijo cacheable', () => {
        // El prefijo estable (contrato + persona) se cachea entre turnos. Si el
        // recuerdo entrara ahí, un turno vería las acciones del anterior.
        const turn = { ...BASE_TURN, recentActions: ACTIONS } as any;
        const { systemPrompt, cachePrefixChars } = service.assembleWithCacheBoundary(CONFIG, turn);

        expect(systemPrompt.slice(0, cachePrefixChars)).not.toContain('<recent_actions>');
        expect(systemPrompt.slice(cachePrefixChars)).toContain('<recent_actions>');
    });
});

describe('quien llena el turno lo hace antes de armarlo', () => {
    /**
     * Un test de orden en el fuente, no de comportamiento: el assembler recibe
     * `turnContext` y devuelve un string sincrónicamente, así que TODA mutación
     * posterior se pierde en silencio — no hay error, no hay tipo que lo note,
     * y el bloque simplemente no sale. Es exactamente lo que pasó.
     */
    const SERVICE_SRC = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');

    it('recentActions se asigna antes de assembleWithCacheBoundary', () => {
        const assignment = SERVICE_SRC.indexOf('.recentActions = priorActions');
        const assembly = SERVICE_SRC.indexOf('assembleWithCacheBoundary(config, turnContext');

        expect(assignment).toBeGreaterThan(-1);
        expect(assembly).toBeGreaterThan(-1);
        expect(assignment).toBeLessThan(assembly);
    });

    it('el prompt se arma una sola vez, así que nada más puede mutar el turno después', () => {
        // Si algún día se re-arma el prompt dentro del loop, este test se cae y
        // hay que revisar el invariante de arriba en cada punto de ensamblado.
        const assemblies = SERVICE_SRC.match(/assembleWithCacheBoundary\(/g) || [];
        expect(assemblies).toHaveLength(1);
    });
});
