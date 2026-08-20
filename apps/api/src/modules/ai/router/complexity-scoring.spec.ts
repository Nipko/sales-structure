import { LLMRouterService } from './llm-router.service';

/**
 * El medidor de complejidad decide si vale la pena un modelo mejor.
 *
 * Estaba calibrado para textos largos —los escalones eran >500, >200 y >50
 * caracteres— y en WhatsApp casi todo caía en el más bajo o en cero. Y `cotiaz`
 * era un typo por `cotiz`: pedir una cotización, de lo más valioso que puede
 * escribir un cliente, puntuaba cero en el eje técnico desde siempre.
 *
 * Importa en una sola dirección: si esto da cero, el ruteo por valor puede
 * ABARATAR el modelo pero nunca mejorarlo.
 */

const score = (text: string): number =>
    (LLMRouterService.prototype as any).analyzeComplexity.call({}, text);

describe('complejidad de un mensaje de chat', () => {
    it('reconoce una cotización, que antes valía cero', () => {
        // El typo exacto que estuvo ahí desde el principio.
        expect(score('Necesito una cotización')).toBeGreaterThan(0);
        expect(score('¿Me pueden cotizar el apartamento?')).toBeGreaterThan(0);
    });

    it('distingue una consulta elaborada de un mensaje suelto', () => {
        const suelto = 'sí';
        const elaborado = 'Hola, quería consultar disponibilidad para el apartamento del 1 al 5 de '
            + 'diciembre para dos personas. ¿Cuál sería el precio total con la limpieza incluida? '
            + '¿Y aceptan pago en cuotas?';

        expect(score(elaborado)).toBeGreaterThan(score(suelto) + 30);
    });

    it('un mensaje de chat normal ya no cae en cero por corto', () => {
        // 40+ caracteres es un mensaje real de WhatsApp, no una parrafada.
        const normal = 'Hola, están disponibles para el fin de semana';
        expect(normal.length).toBeGreaterThan(40);
        expect(score(normal)).toBeGreaterThan(0);
    });

    it('una confirmación sigue siendo simple, que es lo correcto', () => {
        // No se infla artificialmente: "sí" ES simple. Lo que protege el turno
        // que cierra la venta es el piso de modelo, no este puntaje.
        expect(score('sí')).toBe(0);
        expect(score('dale')).toBe(0);
    });

    it('nunca se pasa de 100', () => {
        const bestia = 'precio '.repeat(200) + '???';
        expect(score(bestia)).toBeLessThanOrEqual(100);
    });
});
