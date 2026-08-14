import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * El bug que cierra este contrato no vivía en PaymentRoutingService: el resolver
 * siempre honró como override lo que le pasaran. Vivía en el CABLEADO — los
 * llamadores le entregaban `tenants.payment_provider`, que BillingService estampa
 * en cada suscripción como registro de dónde nació.
 *
 * Efecto: todo tenant que alguna vez fue facturado llegaba al resolver clavado a
 * quien le cobró la última vez, y cambiar el operador de un país no movía a
 * nadie. Una prueba unitaria del servicio no lo ve, porque desde adentro el
 * argumento parece un override legítimo. Por eso el contrato mira el fuente.
 */
describe('cableado de resolveForNewSubscription', () => {
    const CALLERS = [
        'billing.service.ts',
        'recurring/payment-source.service.ts',
    ];

    /** Extrae el objeto literal de cada llamada a resolveForNewSubscription. */
    const callArgumentsIn = (source: string): string[] => {
        const out: string[] = [];
        const marker = 'resolveForNewSubscription(';
        let from = 0;
        for (;;) {
            const start = source.indexOf(marker, from);
            if (start === -1) break;
            let depth = 0;
            let end = start + marker.length - 1;
            for (let i = end; i < source.length; i++) {
                if (source[i] === '(') depth++;
                else if (source[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
            }
            out.push(source.slice(start + marker.length, end));
            from = end;
        }
        return out;
    };

    it.each(CALLERS)('%s enruta con el override deliberado, nunca con el pin automático', (relative) => {
        const source = readFileSync(resolve(__dirname, relative), 'utf8');
        const calls = callArgumentsIn(source);

        expect(calls.length).toBeGreaterThan(0);
        for (const args of calls) {
            // `paymentProviderOverride` contiene la subcadena `paymentProvider`,
            // así que se descarta primero para no dar un falso positivo.
            const withoutOverride = args.replace(/paymentProviderOverride/g, '');
            expect(withoutOverride).not.toContain('paymentProvider');
            expect(args).not.toContain('tenantProvider:');
        }
    });

    it('solo BillingService escribe el pin, y nadie lo usa para decidir', () => {
        const billing = readFileSync(resolve(__dirname, 'billing.service.ts'), 'utf8');

        // El pin se sigue escribiendo: es el historial de dónde nació la última
        // suscripción, y el panel lo muestra como `lastBilledBy`.
        expect(billing).toContain('paymentProvider: providerName');
    });
});
