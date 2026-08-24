import { ConversationsService } from './conversations.service';

/**
 * La reescritura RAG no se dispara con un "sí".
 *
 * El guard era `length < 80`, así que una confirmación entraba: una consulta a
 * la base MÁS una llamada al LLM para expandir dos letras que no tienen
 * referente. Y justo en el turno que cierra la venta, que es el que menos puede
 * permitirse latencia de más.
 */

// Se prueba el corto circuito: si devuelve el texto tal cual SIN tocar la base,
// no hubo reescritura. El prisma falso revienta si alguien consulta.
const prismaQueExplota: any = {
    executeInTenantSchema: jest.fn(() => {
        throw new Error('no debería consultarse para una confirmación');
    }),
};

const rewrite = (text: string, country?: string) =>
    (ConversationsService.prototype as any).rewriteSearchQuery.call(
        { prisma: prismaQueExplota }, text, 'tenant_x', 'conv-1', 't1', country,
    );

beforeEach(() => prismaQueExplota.executeInTenantSchema.mockClear());

describe('confirmaciones: pasan de largo', () => {
    it.each(['sí', 'si', 'Si.', 'ok', 'OK!', 'dale', 'listo', 'perfecto', 'claro', 'de acuerdo', 'yes', 'sim', 'oui'])(
        '"%s" no dispara reescritura', async (texto) => {
            await expect(rewrite(texto)).resolves.toBe(texto);
            expect(prismaQueExplota.executeInTenantSchema).not.toHaveBeenCalled();
        },
    );

    it('un agradecimiento tampoco', async () => {
        await expect(rewrite('gracias')).resolves.toBe('gracias');
    });

    it.each([
        ['hágale', 'CO'],
        ['ya po', 'CL'],
        ['beleza', 'BR'],
    ])('la expresión local "%s" usa el pack %s y no reescribe', async (texto, pais) => {
        await expect(rewrite(texto, pais)).resolves.toBe(texto);
        expect(prismaQueExplota.executeInTenantSchema).not.toHaveBeenCalled();
    });
});

describe('lo que SÍ tiene referente sigue reescribiéndose', () => {
    // El método se traga los fallos de la base y devuelve el texto original, así
    // que lo que se comprueba es que HAYA consultado: eso prueba que no cortó.
    it('una pregunta anafórica intenta resolver el contexto', async () => {
        // "¿y eso cuánto sale?" no se puede buscar tal cual: sin el referente,
        // el embedding no encuentra nada. Esa es la razón de ser del rewrite.
        await rewrite('¿y eso cuánto sale?');
        expect(prismaQueExplota.executeInTenantSchema).toHaveBeenCalled();
    });

    it('"si" como conjunción no se confunde con confirmación', async () => {
        // "si tienen disponibilidad" empieza con "si" pero es una consulta real.
        // El patrón exige que la confirmación sea TODO el mensaje.
        await rewrite('si tienen disponibilidad para diciembre');
        expect(prismaQueExplota.executeInTenantSchema).toHaveBeenCalled();
    });
});
