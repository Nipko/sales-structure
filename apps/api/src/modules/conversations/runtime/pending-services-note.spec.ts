import { pendingServicesNote, templateServicesOfTurn } from './pending-services-note';

const DENTAL = [
    { name: 'Consulta general', contentStatus: 'seeded' },
    { name: 'Consulta especializada', contentStatus: 'seeded' },
    { name: 'Control y seguimiento', contentStatus: 'seeded' },
];
const SALON = [
    { name: 'Color y tratamiento', contentStatus: 'seeded' },
    { name: 'Manicure y pedicure', contentStatus: 'seeded' },
    { name: 'Corte y estilo' },
];

describe('E2aa C01 · servicios de plantilla listados como confirmados', () => {
    it.each([
        ['¡Hola! Somos una clínica dental que ofrece servicios de atención odontológica. Podemos ayudarle con consultas generales, consultas especializadas y controles o seguimientos de tratamientos dentales. ¿Tiene algún motivo específico para su consulta?'],
        ['¡Hola! Somos una clínica dental que ofrece servicios de consulta general, consulta especializada y control o seguimiento de tratamientos odontológicos. ¿Tiene algún motivo específico para su consulta, como dolor, control rutinario o algún tratamiento en mente? Así puedo ayudarle mejor.'],
    ])('dental: se dicen pendientes de confirmar', reply => {
        const out = pendingServicesNote(reply, DENTAL, 'es');
        expect(out).toContain('Tenga en cuenta que Consulta general, Consulta especializada y Control y seguimiento aún están pendientes de confirmar por el negocio.');
        expect(out).toContain(reply.replace(/\s*¿[^?]*\?[^?]*$/u, ''));
    });

    it('la pregunta final queda al final', () => {
        const out = pendingServicesNote('Ofrecemos consulta general y consulta especializada. ¿Desea agendar?', DENTAL, 'es');
        expect(out).toBe('Ofrecemos consulta general y consulta especializada. Tenga en cuenta que Consulta general y Consulta especializada aún están pendientes de confirmar por el negocio. ¿Desea agendar?');
    });

    it('en inglés', () => {
        expect(pendingServicesNote('We offer Color y tratamiento and Manicure y pedicure.', SALON, 'en'))
            .toContain('Please note that Color y tratamiento and Manicure y pedicure are still pending confirmation by the business.');
    });

    it.each([
        ['ya dice que están por confirmar', 'Tenemos consulta general y consulta especializada, aún por confirmar con la clínica.', DENTAL],
        ['un solo servicio de plantilla (una cita, una pregunta por nombre)', 'Su cita de Consulta general quedó para el lunes.', DENTAL],
        ['el confirmado no cuenta', 'Ofrecemos Corte y estilo y Color y tratamiento.', SALON],
        ['no nombra servicios', 'Somos una clínica dental de prueba. ¿En qué le ayudo?', DENTAL],
        ['un control rutinario no es «Control y seguimiento»', '¿Busca un control rutinario o una consulta general?', DENTAL],
    ])('queda igual: %s', (_why, reply, services) => {
        expect(pendingServicesNote(reply, services as any, 'es')).toBeNull();
    });
});

describe('E2ab · los servicios de plantilla del turno salen de tres fuentes', () => {
    it('sin <available_services> (reserva no autorizada): catalogue_authority.pending y list_services', () => {
        const fromAuthority = templateServicesOfTurn({ catalogueAuthority: { pending: ['Consulta general', 'Consulta especializada'] } });
        expect(fromAuthority.map(s => s.name)).toEqual(['Consulta general', 'Consulta especializada']);
        const fromRead = templateServicesOfTurn({}, [{ name: 'list_services', result: { services: [
            { name: 'Control y seguimiento', contentStatus: 'seeded' }, { name: 'Corte y estilo' },
        ] } }]);
        expect(fromRead.map(s => s.name)).toEqual(['Control y seguimiento']);
        const all = templateServicesOfTurn({ availableServices: [], catalogueAuthority: { pending: ['Consulta general', 'Consulta especializada', 'Control y seguimiento'] } });
        expect(pendingServicesNote('Ofrecemos consulta general, consulta especializada y control y seguimiento. ¿Desea agendar?', all, 'es'))
            .toContain('Tenga en cuenta que Consulta general, Consulta especializada y Control y seguimiento aún están pendientes de confirmar por el negocio.');
    });

    it('un servicio confirmado no entra', () => {
        expect(templateServicesOfTurn({ availableServices: [{ name: 'Corte y estilo' }, { name: 'Color y tratamiento', contentStatus: 'seeded' }] })
            .map(s => s.name)).toEqual(['Color y tratamiento']);
    });
});

describe('E2ae · la nota sobrevive y no se repite', () => {
    const DENTAL3 = [{ name: 'Consulta general', contentStatus: 'seeded' }, { name: 'Consulta especializada', contentStatus: 'seeded' }, { name: 'Control y seguimiento', contentStatus: 'seeded' }];
    it('una lista con viñetas precedida de «aunque están pendientes de confirmación» ya lo dice', () => {
        const reply = ['Ofrecemos los siguientes servicios odontológicos, aunque están pendientes de confirmación por parte de la clínica:',
            '- Consulta general', '- Consulta especializada', '- Control y seguimiento', '¿Le interesa alguno?'].join('\n');
        expect(pendingServicesNote(reply, DENTAL3, 'es')).toBeNull();
    });
    it('aplicada dos veces (antes y después del verificador de evidencia) no se repite', () => {
        const reply = 'Podemos ayudarle con consultas generales, consultas especializadas y controles o seguimientos de tratamientos dentales. Así puedo orientarle mejor.';
        const once = pendingServicesNote(reply, DENTAL3, 'es');
        expect(once).toContain('aún están pendientes de confirmar por el negocio');
        expect(pendingServicesNote(once as string, DENTAL3, 'es')).toBeNull();
    });
});
