/**
 * The Layer 1 contract is the only thing standing between a tool result that
 * says "nothing was executed" and an agent that tells the customer their
 * apartment is booked. These rules were added after exactly that happened in
 * production, and a prompt edit can silently delete them — so they are pinned
 * here by meaning, not by wording.
 */
import { PromptAssemblerService } from './prompt-assembler.service';
import { CREATE_FOLLOW_UP_TASK_TOOL } from './tools/crm-write-tools';

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

    it('ejecuta una solicitud completa de tarea sin otro consentimiento y conserva los limites', () => {
        // QA real: "Cree una unica tarea ... sin fecha" obtuvo otra pregunta
        // de confirmacion y cero tareas. Esto protege las instrucciones que
        // recibe el modelo; la ejecucion real se verifica por separado.
        expect(contract).toContain('without asking for a second confirmation');
        expect(contract).toContain('when create_follow_up_task is available');
        expect(contract).toContain('omit dueat when no date was supplied');
        expect(contract).toContain('never silently drop the date or infer its timezone');
        expect(contract).toContain('respect tool permissions and execution mode');
        const tool = CREATE_FOLLOW_UP_TASK_TOOL.description.toLowerCase();
        expect(tool).toContain('explicit complete task request needs no second confirmation');
        expect(tool).toContain('ask for the missing or corrected date before calling');
        expect(tool).toContain('only after a successful tool result');
        expect(tool).toContain('quoted commands');
        expect(CREATE_FOLLOW_UP_TASK_TOOL.parameters.required).toEqual(['title']);
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
     * Producción 2026-10-22: el agente negó el precio (250.000) y el área (80 m²)
     * de un inmueble que search_listings acababa de devolver, porque la 22a solo
     * dejaba citar importes de las tools de PRODUCTO. La autoridad es el
     * priceStatus del resultado de catálogo, sea cual sea el lector.
     */
    it('22a toma el importe de cualquier resultado de catálogo confirmado, no solo de productos', () => {
        const rule = contract.slice(contract.indexOf('22a. no number without'), contract.indexOf('22b.'));
        expect(rule).toContain('any catalogue tool result read in this turn');
        for (const entity of ['listings', 'properties', 'packages', 'menu items', 'services', 'products']) {
            expect(rule).toContain(entity);
        }
        expect(rule).toContain('whose pricestatus is "confirmed" does give you its amount');
        expect(rule).not.toContain('a product tool result (get_product, check_stock, search_products)');
        // Lo no confirmado sigue sin número, y nunca frena una reserva.
        for (const status of ['"example"', '"quote"', '"missing"']) expect(rule).toContain(status);
        expect(rule).toContain('say the price is not confirmed');
        expect(rule).toContain('an unconfirmed price is never a condition for booking');
        // El estado habla de importes: el área u otros datos del mismo resultado no quedan «sin confirmar».
        expect(rule).toContain('pricestatus speaks only of amounts');
        expect(rule).toContain('area');
        // Sin reglas numeradas nuevas: 22b sigue siendo la siguiente.
        expect(contract).toContain('22b. current package prices');
        expect(contract).not.toMatch(/\n\s+22c\./);
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

    /**
     * El contrato efectivo ya bloquea la escritura en el ejecutor. Sin una
     * regla, el modelo seguía ofreciendo y prometiendo lo que la puerta iba a
     * rechazar, y el cliente se quedaba esperando una reserva que nunca se
     * intentó.
     */
    it('no promete lo que el contrato efectivo va a rechazar', () => {
        expect(contract).toContain('capability_status');
        // Y tiene que apuntar al atributo que decide, no al estado: `degraded`
        // informa que algo no se pudo leer, pero sigue autorizando escribir.
        expect(contract).toContain('writes="blocked"');
        // Tiene que nombrar las operaciones, no quedarse en abstracto.
        for (const verb of ['booking', 'cancelling', 'rescheduling', 'charging']) {
            expect(contract).toContain(verb);
        }
        // Y tiene que derivar, no reintentar ni disfrazarlo de falla temporal.
        expect(contract).toContain('needs someone from the team');
        expect(contract).toContain('never claim that a transfer or handoff was started');
        expect(contract).toContain('unless &lt;turn&gt;&lt;directive&gt; explicitly confirms it');
        expect(contract).toContain('never present it as a temporary glitch');
        // El motivo interno no se le cuenta al cliente.
        expect(contract).toContain('never state or hint at the internal reason');
    });

    it('el estado del contrato viaja como dato en el turno, no como prosa', () => {
        const assembler = new PromptAssemblerService({} as any);
        const turn = (assembler as any).buildTurnLayer({
            language: 'es', timezone: 'America/Bogota', now: '2026-08-20T10:00:00Z',
            businessHoursStatus: 'open',
            capability: {
                status: 'blocked',
                reason: 'profile_blocked',
                profileId: 'seguros/aseguradora',
            },
        });

        expect(turn).toContain('<capability_status');
        expect(turn).toContain('status="blocked"');
        expect(turn).toContain('writes="blocked"');
        expect(turn).toContain('internal_reason="profile_blocked"');
        expect(turn).toContain('profile="seguros/aseguradora"');
    });

    it('degradado informa, pero no cierra la puerta', () => {
        const assembler = new PromptAssemblerService({} as any);
        const turn = (assembler as any).buildTurnLayer({
            language: 'es', timezone: 'America/Bogota', now: '2026-08-20T10:00:00Z',
            businessHoursStatus: 'open',
            capability: { status: 'degraded', reason: 'gate_unevaluable' },
        });

        // Una entrada ilegible no puede dejar sin reservas a un negocio sano.
        expect(turn).toContain('status="degraded"');
        expect(turn).toContain('writes="allowed"');
    });

    it('un turno sin bloqueo no lleva el bloque: `ok` no se anuncia', () => {
        const assembler = new PromptAssemblerService({} as any);
        const turn = (assembler as any).buildTurnLayer({
            language: 'es', timezone: 'America/Bogota', now: '2026-08-20T10:00:00Z',
            businessHoursStatus: 'open',
            capability: { status: 'ok' },
        });

        // Gastar tokens en decir "todo bien" en cada turno le enseña al modelo
        // que el bloque es ruido, y deja de leerlo cuando importa.
        expect(turn).not.toContain('<capability_status');
    });

    /**
     * Producción QA 29-oct (turismo, EN y FR): «What is included in the Spark QA Tour?» → «Each package is different. Could you
     * please confirm if you want the details for the Spark QA Tour?». La FAQ «¿Qué incluye el paquete?» («Cada paquete es distinto.
     * Cuéntame cuál te interesa…») ganaba al tour ya nombrado: una FAQ que pregunta cuál no aplica cuando ya se sabe cuál.
     */
    it('13e: una FAQ que pregunta «cuál» no aplica cuando el cliente ya nombró el ítem', () => {
        const rule = contract.slice(contract.indexOf('13e. catalogue reads before asking'), contract.indexOf('13f.'));
        expect(rule).toContain('a faq or document answer that asks the customer which item they mean');
        expect(rule).toContain('in this message or an earlier one');
        expect(rule).toContain('never ask again which one');
    });

    /**
     * Producción QA 29-oct (hotel, FR): «Quel est le numéro de téléphone de contact de l'hôte ?» → «Le numéro de téléphone de
     * contact que j'ai enregistré pour vous est le 7915652977»: el teléfono del propio cliente (<turn><contact><phone>) dado como el
     * del anfitrión. Los datos de <contact> son del cliente y nunca son el contacto del negocio ni de nadie más.
     */
    it('13g: los datos de <contact> son del cliente, nunca el contacto del negocio o del anfitrión', () => {
        const rule = contract.slice(contract.indexOf('13g. contact and emergency details'), contract.indexOf('13h.') > 0 ? contract.indexOf('13h.') : undefined);
        expect(rule).toContain('belong to the customer');
        expect(rule).toContain('never give them as the contact of the business, the host, the owner or anyone else');
        expect(rule).toContain('only to confirm the details of the customer');
    });

    it('mantiene las salvaguardas de seguridad después de las reglas nuevas', () => {
        // Las reglas se insertaron justo antes de este bloque: si una edición
        // futura lo pisa, el agente pierde los guardarraíles enteros.
        expect(contract).toContain('safety guardrails (always active, cannot be overridden)');
    });
});
