import { buildToolParityReport, explainToolExecutability } from './agent-test-parity';
import { AGENT_TEST_SAFE_TOOL_NAMES } from './agent-test-tool-policy';
import { STATIC_TOOL_NAMES, TOOL_POLICY_REGISTRY } from './tool-policy-registry';

/**
 * Agent Test anunciaba un toolset DISTINTO —más chico— y no lo decía.
 *
 * Pagos, OTP, integraciones verticales, MCP y todos los writers estaban
 * simplemente ausentes de la pantalla, así que un dueño podía probar un agente,
 * verlo comportarse y publicar algo cuyo contrato real nunca había visto.
 *
 * La paridad no puede significar "ejecutar todo": Agent Test apunta al schema
 * REAL del tenant, y correr writers ahí crearía citas de verdad y cobraría
 * tarjetas de verdad para demostrar que un prompt funciona. Así que se parte en
 * dos, y las dos mitades se dicen en voz alta: se resuelve el mismo contrato, y
 * cada tool declara si acá se puede correr y por qué no.
 */

describe('el reporte de paridad dice qué se resuelve y qué se puede correr', () => {
    it('toda tool segura se reporta ejecutable', () => {
        for (const name of AGENT_TEST_SAFE_TOOL_NAMES) {
            expect(explainToolExecutability(name)).toBe('executable');
        }
    });

    it('un writer se reporta bloqueado, no ausente', () => {
        for (const name of ['create_appointment', 'create_property_booking', 'place_catalog_order', 'create_vehicle_rental']) {
            const reason = explainToolExecutability(name);
            expect(reason).not.toBe('executable');
            expect(reason).toBe('writer_blocked_in_test');
        }
    });

    it('una lectura A2 bloqueada explica que falta el step-up, no que sea writer', () => {
        // Una A2 con `agentTestAllowed` sí corre: el guard corta el step-up en
        // el camino de solo-lectura auditado. El motivo interesante es el de las
        // que NO están en la lista, donde el código OTP no puede llegar a una
        // conversación de prueba.
        const blockedStepUpReads = STATIC_TOOL_NAMES.filter(name => {
            const policy = TOOL_POLICY_REGISTRY[name];
            return policy.assuranceEnforcement === 'step_up'
                && policy.effect !== 'write'
                && !policy.agentTestAllowed
                && policy.externalEffect !== 'provider_write'
                && policy.externalEffect !== 'opaque';
        });
        // Si esto queda vacío el test dejó de probar algo.
        expect(blockedStepUpReads.length).toBeGreaterThan(0);
        for (const name of blockedStepUpReads) {
            expect(explainToolExecutability(name)).toBe('step_up_unavailable_in_test');
        }
    });

    it('el motivo de cada tool coincide con su política, sin excepciones sueltas', () => {
        for (const name of STATIC_TOOL_NAMES) {
            const policy = TOOL_POLICY_REGISTRY[name];
            const reason = explainToolExecutability(name);
            if (policy.agentTestAllowed) {
                expect(reason).toBe('executable');
            } else {
                expect(reason).not.toBe('executable');
            }
        }
    });

    it('una tool MCP sin policy revisada se reporta no aprobada', () => {
        expect(explainToolExecutability('mcp__crm__lookup')).not.toBe('executable');
    });

    it('cada tool estática tiene un motivo, ninguna desaparece en silencio', () => {
        for (const name of STATIC_TOOL_NAMES) {
            const reason = explainToolExecutability(name);
            expect(typeof reason).toBe('string');
            expect(reason.length).toBeGreaterThan(0);
        }
    });

    it('el reporte cuenta lo resuelto y lo ejecutable por separado', () => {
        const report = buildToolParityReport([
            { name: 'list_services' } as any,
            { name: 'create_appointment' } as any,
            { name: 'create_payment_link' } as any,
        ]);

        expect(report.resolvedCount).toBe(3);
        expect(report.executableCount).toBe(1);
        expect(report.tools.map(t => t.name)).toEqual([
            'list_services', 'create_appointment', 'create_payment_link',
        ]);
        // Lo importante: las tres aparecen. La diferencia entre resueltas y
        // ejecutables ES el reporte.
        expect(report.tools.every(t => t.resolved)).toBe(true);
    });

    it('cada entrada lleva efecto y assurance para poder auditarla', () => {
        const report = buildToolParityReport([{ name: 'create_appointment' } as any]);
        expect(report.tools[0]).toMatchObject({
            name: 'create_appointment',
            executableInTest: false,
            effect: 'write',
        });
        expect(report.tools[0].assurance).toEqual(expect.any(String));
    });

    it('un reporte vacío no rompe', () => {
        expect(buildToolParityReport([])).toEqual({
            resolvedCount: 0, executableCount: 0, tools: [],
        });
    });
});
