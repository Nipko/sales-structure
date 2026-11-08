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

describe('<catalogue_authority> con servicios de plantilla (E2y C01)', () => {
    const assembler = new PromptAssemblerService({} as any);
    const render = (turn: any): string => (assembler as any).buildTurnLayer(turn);

    it('marca el ofrecido pendiente y añade la nota si <available_services> no la trae', () => {
        const turn = render({ catalogueAuthority: { offered: ['Consulta general', 'Limpieza'], notInCatalogue: [], pending: ['Consulta general'] } });
        expect(turn).toContain('<offered content_status="seeded">Consulta general</offered>');
        expect(turn).toContain('<offered>Limpieza</offered>');
        expect(turn.split('<note>').length - 1).toBe(1);
    });

    it('sin pendientes el bloque no cambia; con <available_services> marcado la nota no se repite', () => {
        expect(render({ catalogueAuthority: { offered: ['Limpieza'], notInCatalogue: [] } })).not.toContain('content_status');
        const both = render({
            availableServices: [{ id: 's1', name: 'Consulta general', contentStatus: 'seeded' }],
            catalogueAuthority: { offered: ['Consulta general'], notInCatalogue: [], pending: ['Consulta general'] },
        });
        expect(both.split('<note>').length - 1).toBe(1);
    });
});
