import { hasToolCallMarkup, stripToolCallMarkup } from './tool-call-markup.util';
import { stripInternalMarkers } from './internal-markers.util';

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
        // an unknown snake_case tag is a call when it has the STRUCTURE of one
        expect(hasToolCallMarkup('Listo <get_product id="1"/>')).toBe(true);
        expect(stripToolCallMarkup('Listo <get_product id="1"/> ya')).toBe('Listo ya');
        expect(hasToolCallMarkup('Listo <get_product>abc</get_product>')).toBe(true);
        expect(hasToolCallMarkup('Listo <get_product><sku_id>1')).toBe(true);
    });

    it('a snake_case call never cuts past its own closing tag or line', () => {
        expect(stripToolCallMarkup('Hola <get_product><sku_id>1</sku_id></get_product> Total 5.')).toBe('Hola Total 5.');
        expect(stripToolCallMarkup('Hola <get_product><sku_id>1\nTotal 5.')).toBe('Hola\nTotal 5.');
    });

    it.each([
        // placeholders, references and addresses in ordinary replies
        'Escríbenos a <ventas_bogota@tienda.com> y te respondemos',
        'Responde con <tu_nombre> y <tu_correo>',
        'Ref: <SKU_AB12>',
        'si x < y_z > w',
        'Escríbanos a <ventas_bogota@tienda.com> y le respondemos con el catálogo completo.',
        'Use <mi_codigo> en la caja y pague.',
    ])('does not cut a reply with a harmless snake_case tag: %s', text => {
        expect(hasToolCallMarkup(text)).toBe(false);
        expect(stripToolCallMarkup(text)).toBe(text);
        expect(stripInternalMarkers(text)).toBe(text);
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
