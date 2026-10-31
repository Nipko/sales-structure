import { EVALUATION_OUTPUT_TABLES } from './evaluation-revision';

/**
 * Fase E (31-oct-2026): la primera medición con el ensayo falló en todos los casos con
 * `evaluation_dependencies_changed:tenant.readiness_evaluations`. El turno evalúa la preparación cuando la caché no
 * tiene el contrato (R4) y esa evaluación guarda su fila; si la tabla cuenta como dependencia, el turno invalida la
 * foto congelada del agente sobre la que corre. Toda tabla que un turno escribe como contabilidad propia debe ser
 * salida de evaluación, no dependencia.
 */
describe('tablas que un turno escribe sobre sí mismo no invalidan la foto del agente', () => {
    it.each([
        'readiness_evaluations', // R2/R4: historial de la preparación, derivado de tablas que sí son dependencia
        'go_live_decisions', // R4: decisión del control de salida por mensaje entrante
        'pending_questions', 'pending_question_waiters', // R5: demanda y esperas
        'rehearsal_runs', 'rehearsal_results', // R7: el ensayo guarda sus resultados mientras corre
    ])('%s es salida de evaluación', table => {
        expect(EVALUATION_OUTPUT_TABLES.has(table)).toBe(true);
    });

    it('los valores del negocio siguen siendo dependencia: cambiarlos debe invalidar una evaluación', () => {
        for (const table of ['requirement_values', 'requirement_value_versions', 'faqs', 'services']) {
            expect(EVALUATION_OUTPUT_TABLES.has(table)).toBe(false);
        }
    });
});
