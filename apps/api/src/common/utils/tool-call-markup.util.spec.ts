import { hasToolCallMarkup, stripToolCallMarkup } from './tool-call-markup.util';
import { stripInternalMarkers } from './internal-markers.util';
import { promisesActionWithoutTool } from './outcome-claim.util';

/** A tool call written as text is detected and removed, never parsed into a call. */
const SHAPES: Array<[string, string]> = [
    ['plain tool tag', '<create_appointment><service_id>abc</service_id><date>2027-01-05</date></create_appointment>'],
    ['unclosed tool tag', 'Voy a reservarla. <create_appointment><service_id>abc'],
    ['DSML', '<｜｜DSML｜｜ invoke name="create_appointment">\n<｜｜DSML｜｜ parameter name="date" string="true">2027-01-05</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>'],
    ['DSML function_calls', '<｜DSML｜function_calls>\n<｜DSML｜invoke name="create_appointment">\n</｜DSML｜invoke>\n</｜DSML｜function_calls>'],
    ['invoke', '<invoke name="create_appointment"><parameter name="date">2027-01-05</parameter></invoke>'],
    ['function_calls', '<function_calls><invoke name="check_availability"></invoke></function_calls>'],
    ['tool_call', '<tool_call>{"name":"create_appointment","arguments":{}}</tool_call>'],
    ['DeepSeek tool tokens', '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>create_appointment<｜tool▁sep｜>{}<｜tool▁call▁end｜><｜tool▁calls▁end｜>'],
    ['parameter only', 'ok <parameter name="x">1</parameter>'],
];

describe('hasToolCallMarkup / stripToolCallMarkup', () => {
    it.each(SHAPES)('%s is detected and removed', (_label, text) => {
        expect(hasToolCallMarkup(text)).toBe(true);
        const stripped = stripToolCallMarkup(text);
        expect(hasToolCallMarkup(stripped)).toBe(false);
        expect(stripped).not.toMatch(/[<>]|DSML|create_appointment|service_id|invoke/);
    });

    it('keeps the sentence the model wrote before and after the call', () => {
        expect(stripToolCallMarkup('Claro, ya lo registro. <create_appointment><date>2027-01-05</date></create_appointment> Gracias.'))
            .toBe('Claro, ya lo registro. Gracias.');
        expect(stripToolCallMarkup('Estoy gestionando su cita.\n\n<｜｜DSML｜｜ invoke name="create_appointment">\n</｜｜DSML｜｜ invoke>')).toBe('Estoy gestionando su cita.');
    });

    it('finds a tag named like a published tool even when the shape is unusual', () => {
        expect(hasToolCallMarkup('Listo <ping id="1"/>', ['ping'])).toBe(true);
        expect(stripToolCallMarkup('Listo <ping id="1"/> ya', ['ping'])).toBe('Listo ya');
        expect(hasToolCallMarkup('Listo <ping id="1"/>')).toBe(false);
        // any snake_case tag is a call even when the tool is unknown to the turn
        expect(hasToolCallMarkup('Listo <get_product id="1"/>')).toBe(true);
    });

    it.each([
        'Cuesta $119.900 y hay 3 unidades. ¿Le sirve a las 16:00?',
        'Si el total es < 50.000 y > 10.000 aplica el envío gratis.',
        'Escríbanos a ventas@tienda.com o visite https://tienda.com/p?id=1&x=2',
        '<3 gracias! :> 5 < 6',
        'Use el código ABC_123 en la caja.',
    ])('leaves normal text alone: %s', text => {
        expect(hasToolCallMarkup(text)).toBe(false);
        expect(stripToolCallMarkup(text)).toBe(text);
    });
});

describe('stripInternalMarkers is the last line of defence at egress', () => {
    it.each(SHAPES)('%s never leaves the platform', (_label, text) => {
        const out = stripInternalMarkers(`Hola. ${text}`);
        expect(out).not.toMatch(/[<>]|DSML|create_appointment|invoke/);
        expect(out.startsWith('Hola.')).toBe(true);
    });

    it('still strips the knowledge citation, and both together', () => {
        expect(stripInternalMarkers('Abrimos a las 9 [Article: Horarios].')).toBe('Abrimos a las 9.');
        expect(stripInternalMarkers('Abrimos a las 9 [Article: Horarios]. <create_appointment><date>1</date></create_appointment>')).toBe('Abrimos a las 9.');
    });
});

describe('promisesActionWithoutTool', () => {
    it.each([
        'Estoy gestionando la confirmación de su cita del 5 de enero a las 16:00. Le avisaré en cuanto esté lista.',
        'Estoy gestionando la confirmación… Te avisaré.',
        'Le aviso apenas quede registrada.',
        'Estoy procesando su reserva.',
        "I'm processing your booking. I'll let you know as soon as it is done.",
        'I will notify you once it is confirmed.',
        'Estou processando o seu agendamento. Vou avisar quando estiver pronto.',
        'Je suis en train de confirmer votre rendez-vous. Je vous préviendrai.',
    ])('catches: %s', text => {
        expect(promisesActionWithoutTool(text)).toBe(true);
    });

    it.each([
        'Su cita de Corte y estilo es el 5 de enero a las 16:00. ¿La confirmo?',
        '¿Confirmo la cita? Responda sí o no.',
        'Atendemos de lunes a viernes de 9 a 18.',
        'Puede avisarnos si necesita cambiarla.',
        'Let me know if you need anything else.',
    ])('leaves alone: %s', text => {
        expect(promisesActionWithoutTool(text)).toBe(false);
    });
});
