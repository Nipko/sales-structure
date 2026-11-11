import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regla de documento de identidad en las plantillas (2026-11-10): el piso L1 prohíbe pedir documentos por chat, pero una
 * plantilla no puede llevar al agente a negar un requisito que el negocio declaró (E2ai: «No necesitamos su número de
 * documento»). Toda regla que prohíbe pedir la cédula también ordena informar el documento cuando el negocio lo exige.
 */
describe('plantillas: no pedir la cédula no es negar el requisito', () => {
    const source = readFileSync(join(__dirname, 'persona.service.ts'), 'utf8');
    const rules = source.split('\n').filter(line => /pidas.*(cedula|DNI|documento de identidad)/i.test(line) && /^\s*'/.test(line));

    it('hay reglas de documento en las plantillas', () => expect(rules.length).toBeGreaterThanOrEqual(6));

    it.each(rules.map(rule => [rule.trim().slice(1, 60), rule]))('%s… informa el requisito declarado', (_label, rule) => {
        expect(rule).toMatch(/informa cual y cuando se presenta; nunca digas que no se necesita/);
    });
});
