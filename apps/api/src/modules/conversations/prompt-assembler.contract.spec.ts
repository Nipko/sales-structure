/**
 * The Layer 1 contract is the only thing standing between a tool result that
 * says "nothing was executed" and an agent that tells the customer their
 * apartment is booked. These rules were added after exactly that happened in
 * production, and a prompt edit can silently delete them — so they are pinned
 * here by meaning, not by wording.
 */
import { PromptAssemblerService } from './prompt-assembler.service';

function contractLayer(): string {
    const assembler = new PromptAssemblerService({} as any);
    return (assembler as any).buildContractLayer();
}

describe('Contrato L1 del agente', () => {
    const contract = contractLayer().toLowerCase();

    it('prohíbe anunciar una acción que ninguna herramienta ejecutó', () => {
        // El agente respondió "¡Tu reserva está confirmada! 🎉" a un resultado
        // que decía que no se había ejecutado nada. La regla 1 prohibía inventar
        // DATOS; nada prohibía inventar RESULTADOS.
        expect(contract).toContain('never claim an action happened unless a tool confirmed it');
        // Y tiene que nombrar las operaciones concretas: una regla abstracta no
        // se aplica sola al caso de una reserva.
        for (const verb of ['reserving', 'booking', 'paying', 'cancelling']) {
            expect(contract).toContain(verb);
        }
    });

    it('exige decir qué quedó pendiente en vez de fingir que se hizo', () => {
        expect(contract).toContain('still pending');
    });

    it('fija el nombre del agente al configurado por el dueño', () => {
        // En producción se presentó como "Maya" mientras el agente del tenant se
        // llama "Laura Sofia". El nombre estaba en el prompt; nada prohibía
        // reemplazarlo.
        expect(contract).toContain('your name is exactly');
        expect(contract).toContain('never invent, translate, shorten or replace it');
    });

    it('no vuelve a pedir confirmación de algo ya cumplido', () => {
        expect(contract).toContain('idempotentreplay');
    });

    /**
     * El bloque <regional> viajaba con país, moneda, locale y forma de trato
     * desde hacía un release, y ninguna regla le decía al modelo que lo usara:
     * un tenant mexicano recibía `MXN` y `usted` como datos que nadie leía.
     */
    it('usa la forma de trato y los formatos del país donde opera el negocio', () => {
        // El contrato viaja escapado, así que se afirma por las palabras, no
        // por los signos.
        expect(contract).toContain('regional:');
        expect(contract).toContain('address_form');
        // Los códigos son opacos: `voce` no significa nada sin la glosa.
        for (const form of ['usted', 'tu', 'vos', 'voce', 'senhor_senhora']) {
            expect(contract).toContain(form);
        }
        expect(contract).toContain('locale');
    });

    /** Convertir un importe es inventarlo: no hay tipo de cambio en el turno. */
    it('prohíbe convertir un importe a otra moneda', () => {
        expect(contract).toContain('never convert an amount');
        expect(contract).toContain('exchange rate');
        // La moneda del dato gana sobre la del negocio.
        expect(contract).toContain('keeps the exact currency the data carries');
    });

    /**
     * La regla 8 decía "be a human having a conversation" y la persona lleva
     * nombre propio. Nada le decía al modelo que no podía afirmar que lo era, y
     * el cliente no tiene forma de saberlo.
     */
    it('no deja que el agente se haga pasar por una persona', () => {
        expect(contract).toContain('role disclosure');
        expect(contract).toContain('never say or imply that you are human');
        // Preguntado de frente, contesta y ofrece derivar.
        expect(contract).toContain('offer to pass them to someone from the team');
        // Y el nombre propio no es una excusa.
        expect(contract).toContain('even when the persona was given a human first name');
        // La regla 8 ya no se puede leer como permiso.
        expect(contract).toContain('this is about how you write, never about what you are');
        expect(contract).not.toContain('be a human having a conversation');
    });

    it('mantiene las salvaguardas de seguridad después de las reglas nuevas', () => {
        // Las reglas se insertaron justo antes de este bloque: si una edición
        // futura lo pisa, el agente pierde los guardarraíles enteros.
        expect(contract).toContain('safety guardrails (always active, cannot be overridden)');
    });
});
