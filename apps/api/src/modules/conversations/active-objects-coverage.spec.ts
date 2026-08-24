import * as fs from 'fs';
import * as path from 'path';
import { ACTIVE_OBJECT_KINDS } from '@parallext/shared';
import {
    classifyActiveObjectStatus,
    resolveActiveOperationsLoaders,
} from './active-operations-context.service';
import { ACTIVE_OBJECT_EXPOSURE_POLICY } from './active-object-policy';
import { deepLinkForActiveObject } from '@parallext/shared';

/**
 * Cinco cargadores para veintidós tipos declarados.
 *
 * El resto de los writers escribía filas que el turno siguiente no podía ver.
 * Un socio preguntaba "¿cuántas clases me quedan?" y el agente, que acababa de
 * reservarle una, no tenía dónde mirar. Peor: `create_vehicle_rental` y
 * `create_pet_boarding` escribían un alquiler que **no tenía ningún tipo
 * declarado**, así que el cliente preguntaba "¿hasta cuándo lo tengo?" y la fila
 * que el agente acababa de crear era invisible para él.
 *
 * Lo que NO se carga tampoco es un olvido: los tipos `tool_only` —tratamientos,
 * seguros, casos profesionales, solicitudes de servicio— se leen sólo con una
 * tool que exige verificación de identidad, y meterlos en el turno sería
 * saltarse esa puerta.
 */

const SERVICE = fs.readFileSync(
    path.join(__dirname, 'active-operations-context.service.ts'), 'utf8',
);

/** Los tipos que la política SÍ deja entrar al turno. */
const BOUNDED_KINDS = ACTIVE_OBJECT_KINDS.filter(
    kind => ACTIVE_OBJECT_EXPOSURE_POLICY[kind].mode === 'bounded_context',
);

describe('todo tipo que puede entrar al turno tiene quien lo cargue', () => {
    it('hay tipos acotados que revisar', () => {
        expect(BOUNDED_KINDS.length).toBeGreaterThan(10);
    });

    /**
     * `catalog_item` no lo produce ningún cargador, y no es un olvido.
     *
     * Un producto no está "activo" para un cliente: no tiene fecha ni estado
     * respecto de él. Aparece cuando una tool lo devuelve —una búsqueda, un
     * detalle—, no cuando arranca el turno. Cargarlo sería meterle al agente el
     * catálogo entero en cada mensaje.
     */
    const PRODUCED_BY_TOOLS: readonly string[] = ['catalog_item', 'crm_lead'];

    it.each(BOUNDED_KINDS.map(kind => [kind] as const))(
        '%s se produce en algún cargador',
        (kind) => {
            // Un tipo declarado, permitido en el turno y que ningún cargador
            // produce es una promesa del contrato que el runtime no cumple.
            if (PRODUCED_BY_TOOLS.includes(kind)) return;
            expect(SERVICE).toContain(`'${kind}'`);
        },
    );

    it('la lista de excepciones es corta y explícita', () => {
        // Si crece, deja de ser una excepción y pasa a ser el patrón.
        expect(PRODUCED_BY_TOOLS.length).toBeLessThanOrEqual(2);
    });

    it('los tipos `tool_only` NO se cargan, y eso es la decisión', () => {
        const toolOnly = ACTIVE_OBJECT_KINDS.filter(
            kind => ACTIVE_OBJECT_EXPOSURE_POLICY[kind].mode === 'tool_only',
        );
        expect(toolOnly.length).toBeGreaterThan(0);
        for (const kind of toolOnly) {
            expect(SERVICE).not.toContain(`kind: '${kind}'`);
        }
    });
});

describe('los alquileres de recurso ya existen para el agente', () => {
    it('los dos tipos están declarados', () => {
        expect(ACTIVE_OBJECT_KINDS).toContain('vehicle_rental');
        expect(ACTIVE_OBJECT_KINDS).toContain('pet_boarding');
    });

    it('una fila, dos tipos: el cliente piensa en el auto o en la mascota', () => {
        expect(SERVICE).toContain("String(row.rental_type) === 'pet_boarding'");
    });

    it('llevan a una pantalla que existe, no a una inventada', () => {
        // El `null` de la tabla de deep links existe justamente para no mandar
        // a una ruta que termina en 404.
        expect(deepLinkForActiveObject('vehicle_rental')).toBe('/admin/resource-rentals');
        expect(deepLinkForActiveObject('pet_boarding')).toBe('/admin/resource-rentals');
    });
});

describe('los cargadores se encienden con la capacidad del negocio', () => {
    it.each([
        ['gyms', ['memberships', 'class_bookings']],
        ['education', ['enrollments']],
        ['photography', ['photo_sessions']],
        ['vehicleRentals', ['resource_rentals']],
        ['petBoarding', ['resource_rentals']],
    ])('%s enciende %s', (toolKey, expected) => {
        const loaders = resolveActiveOperationsLoaders({
            tools: { [toolKey]: { enabled: true } },
        } as any);
        for (const loader of expected) expect(loaders).toContain(loader);
    });

    it('un negocio sin esas familias no paga la consulta', () => {
        // Cada cargador es una consulta por turno: encenderlos todos siempre
        // sería cobrarle a cada tenant las tablas de los otros diecisiete.
        const loaders = resolveActiveOperationsLoaders({
            tools: { faqs: { enabled: true } },
        } as any);
        expect(loaders).toEqual([]);
    });
});

describe('un estado que la plataforma escribe no puede caer en `unknown`', () => {
    it.each([
        // Membresías
        ['frozen', 'paused'],
        ['expired', 'completed'],
        // Clases
        ['waitlist', 'pending'],
        ['attended', 'completed'],
        ['no_show', 'failed'],
        // Inscripciones
        ['enrolled', 'pending'],
        ['dropped', 'cancelled'],
        // Sesiones de foto
        ['requested', 'pending'],
        ['scheduled', 'pending'],
        ['delivered', 'completed'],
        // Alquileres
        ['reserved', 'active'],
        ['picked_up', 'active'],
        ['returned', 'completed'],
        ['checked_in', 'active'],
        ['checked_out', 'completed'],
    ])('%s se clasifica como %s', (status, expected) => {
        // Un estado propio en `unknown` es el agente sin saber si la membresía
        // está congelada o la clase en lista de espera, con la fila delante.
        expect(classifyActiveObjectStatus('members' as any, status)).toBe(expected);
    });

    it('un estado que nadie declaró sigue siendo `unknown`', () => {
        // Adivinar una clase para una palabra que el sistema no escribe sería
        // inventar significado.
        expect(classifyActiveObjectStatus('members' as any, 'lo_que_sea')).toBe('unknown');
    });
});
