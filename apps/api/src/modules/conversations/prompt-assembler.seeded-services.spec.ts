import { PromptAssemblerService, SEEDED_SERVICES_NOTE } from './prompt-assembler.service';

/** E2x C01 (opción B): los servicios de la plantilla del alta llegan marcados al prompt y con la nota que los acota. */
describe('<available_services> con servicios de plantilla', () => {
    const assembler = new PromptAssemblerService({} as any);
    const render = (services: any[]): string => (assembler as any).buildTurnLayer({ availableServices: services });

    it('marca el servicio sembrado y añade la nota una sola vez', () => {
        const turn = render([
            { id: 's1', name: 'Corte y estilo', price: 40000, currency: 'COP' },
            { id: 's2', name: 'Color y tratamiento', priceStatus: 'example', contentStatus: 'seeded', description: 'Coloración completa' },
            { id: 's3', name: 'Manicure y pedicure', priceStatus: 'example', contentStatus: 'example' },
        ]);
        expect(turn).toContain('<service id="s1" price="40000" currency="COP">Corte y estilo</service>');
        expect(turn).toMatch(/<service id="s2"[^>]*content_status="seeded">Color y tratamiento<\/service>/);
        expect(turn).toMatch(/<service id="s3"[^>]*content_status="example">Manicure y pedicure<\/service>/);
        expect(turn.split('<note>').length - 1).toBe(1);
        expect(turn).toContain('comes from a setup template');
        expect(SEEDED_SERVICES_NOTE).toMatch(/never state its description, duration or price as fact/);
    });

    it('sin servicios de plantilla el bloque no cambia', () => {
        const turn = render([{ id: 's1', name: 'Corte y estilo', price: 40000 }]);
        expect(turn).not.toContain('content_status');
        expect(turn).not.toContain('<note>');
    });
});
