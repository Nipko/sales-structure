import * as fs from 'fs';
import * as path from 'path';
import { normalizePhoneE164 } from './phone.util';

/**
 * El `'57'` por defecto y sus trece llamadores.
 *
 * `normalizePhoneE164` tenía `defaultCountryCode = '57'` y **ninguna** de las
 * llamadas lo pasaba. Un número mexicano o argentino escrito sin prefijo se
 * volvía colombiano, y en identidad eso no es cosmético: los contactos se
 * cruzan por `phone_normalized`, así que dos personas distintas terminaban
 * fusionadas en un solo contacto y no hay deshacer que las separe.
 *
 * Esta prueba fija las dos mitades del arreglo: que la función ya no invente un
 * país, y que **ningún llamador vuelva a omitir la región** — que es la mitad
 * que se pierde primero, porque agregar una llamada nueva sin el segundo
 * argumento compila perfecto.
 */

const API_SRC = path.join(__dirname, '../..');

/** Los ficheros que llaman al normalizador, sin contar pruebas. */
function callers(): { file: string; source: string }[] {
    const found: { file: string; source: string }[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
            const source = fs.readFileSync(full, 'utf8');
            if (source.includes('normalizePhoneE164(')) found.push({ file: full, source });
        }
    };
    walk(API_SRC);
    return found.filter(c => !c.file.endsWith('phone.util.ts'));
}

describe('el normalizador ya no inventa un país', () => {
    it('sin región, un número nacional no se normaliza', () => {
        expect(normalizePhoneE164('3001234567')).toBeNull();
        expect(normalizePhoneE164('55 1234 5678')).toBeNull();
        expect(normalizePhoneE164('3001234567', null)).toBeNull();
        expect(normalizePhoneE164('3001234567', undefined)).toBeNull();
    });

    it('con región, resuelve al país que el negocio declaró', () => {
        expect(normalizePhoneE164('3001234567', 'CO')).toBe('+573001234567');
        expect(normalizePhoneE164('55 1234 5678', 'MX')).toBe('+525512345678');
        expect(normalizePhoneE164('987654321', 'PE')).toBe('+51987654321');
    });

    it('un E.164 explícito no necesita región', () => {
        // Perder el prefijo que el cliente SÍ escribió es el error opuesto.
        expect(normalizePhoneE164('+573001234567')).toBe('+573001234567');
        expect(normalizePhoneE164('+5491112345678')).toBe('+5491112345678');
    });

    it('un prefijo no es una identificación', () => {
        // `5512345678` empieza con `55` (Brasil) y tiene ocho dígitos
        // nacionales, un largo que Brasil no usa. Antes salía `+5512345678`
        // con la misma confianza que un número real.
        expect(normalizePhoneE164('5512345678')).toBeNull();
    });

    it('el país declarado gana sobre el barrido de prefijos', () => {
        // Un número mexicano de diez dígitos que empieza con 57 no es
        // colombiano por empezar con 57.
        expect(normalizePhoneE164('5712345678', 'MX')).toBe('+525712345678');
    });
});

describe('ningún llamador omite la región', () => {
    const found = callers();

    it('hay llamadores que revisar', () => {
        // Si esto cae a cero, el barrido dejó de encontrar los ficheros y la
        // prueba de abajo pasaría sin verificar nada.
        expect(found.length).toBeGreaterThanOrEqual(8);
    });

    it.each(callers().map(c => [path.relative(API_SRC, c.file), c] as const))(
        '%s pasa siempre una región',
        (_file, caller) => {
            // Una llamada de un solo argumento compila perfecto y vuelve a
            // introducir el defecto en silencio, así que se prohíbe la forma.
            const singleArg = /normalizePhoneE164\(\s*[^),]*\s*\)/g;
            const offenders = (caller.source.match(singleArg) || [])
                // `normalizePhoneE164(x, y)` no matchea; esto sólo caza la de
                // un argumento. Se excluyen las menciones en comentarios.
                .filter(match => !match.includes(','));
            expect(offenders).toEqual([]);
        },
    );
});
