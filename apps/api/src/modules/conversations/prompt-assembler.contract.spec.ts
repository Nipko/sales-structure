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

    it('mantiene las salvaguardas de seguridad después de las reglas nuevas', () => {
        // Las reglas se insertaron justo antes de este bloque: si una edición
        // futura lo pisa, el agente pierde los guardarraíles enteros.
        expect(contract).toContain('safety guardrails (always active, cannot be overridden)');
    });
});
