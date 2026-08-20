import { readFileSync } from 'fs';
import { resolve } from 'path';
import { promisesLaterDelivery } from '../../common/utils/outcome-claim.util';

/**
 * "Voy a generar el enlace de pago ahora. Un momento..."
 *
 * Eso respondió el agente en producción el 19-ago DESPUÉS de que el backend ya
 * hubiera ejecutado `create_payment_link` server-side. El resultado —el enlace o
 * el fallo— ya estaba en la mano y en la directiva del turno. La conversación
 * quedó congelada: cada turno es pregunta→respuesta y no existe nada que mande
 * ese segundo mensaje prometido.
 */

describe('promesas de entrega futura', () => {
    it('reconoce la frase exacta que congeló la conversación', () => {
        expect(promisesLaterDelivery('Perfecto. Voy a generar el enlace de pago ahora. Un momento...')).toBe(true);
    });

    it('reconoce las variantes de diferir en los cuatro idiomas', () => {
        const diferidas = [
            'Ya te lo envío',
            'Dame un momento y te confirmo',
            'Enseguida te paso el enlace',
            "I'll generate the link, one moment",
            'Vou gerar o link, um momento',
            'Je vais générer le lien, un instant',
        ];
        for (const texto of diferidas) {
            expect(promisesLaterDelivery(texto)).toBe(true);
        }
    });

    it('no confunde una respuesta que YA entrega el resultado', () => {
        const entregadas = [
            'Este es tu enlace de pago: https://pago.example/abc',
            'Tu reserva del 1 al 5 de diciembre está confirmada.',
            'El total es 1.080.000 COP. ¿Confirmas?',
            'No pude crear el enlace: el medio de pago no está configurado.',
        ];
        for (const texto of entregadas) {
            expect(promisesLaterDelivery(texto)).toBe(false);
        }
    });

    it('tolera acentos y mayúsculas', () => {
        expect(promisesLaterDelivery('YA TE LO ENVÍO')).toBe(true);
    });
});

describe('el cableado', () => {
    const SRC = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');

    it('sólo se controla cuando la operación ya se ejecutó', () => {
        // Fuera de ese caso "dame un momento" es legítimo, y el auditor de
        // reclamos lo excluye a propósito. Disparar siempre sería ruido.
        expect(SRC).toContain('const outcomeAlreadyKnown = (executedTools || []).some(t => isBackingTool(t?.name))');
        // La condición ganó una salvedad: cuando el backend manda el enlace en
        // su propia burbuja, anunciarlo es CIERTO y no se reescribe.
        expect(SRC).toContain('outcomeAlreadyKnown && !backendWillDeliver && promisesLaterDelivery(response)');
    });

    it('deja señal cuando el reintento vuelve a diferir', () => {
        // Sin esto el turno se pierde en silencio: el dueño no tiene forma de
        // enterarse de que un cliente quedó esperando.
        expect(SRC).toContain("'deferred_after_execution_unfixed'");
    });
});
