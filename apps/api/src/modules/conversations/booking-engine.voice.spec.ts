import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Clean-chat regression 2026-10-08: the booking engine's texts mixed «tú» and «usted» in the same conversation
 * («Cuéntame, ¿qué día te viene mejor?» then «¿Desea cambiar su cita…?»). The persona/country formality is applied
 * when the model voices the engine's text; the engine's own wording is the baseline it starts from, so it is
 * ONE register: usted in Spanish, the neutral «você» / «vous» forms in Portuguese and French.
 */
const source = readFileSync(resolve(__dirname, 'booking-engine.service.ts'), 'utf8');
const block = (from: string, to: string) => source.slice(source.indexOf(`\n    ${from}: {`), source.indexOf(`\n    ${to}: {`));
const es = block('es', 'en');
const pt = block('pt', 'fr');
const fr = source.slice(source.indexOf('\n    fr: {'), source.indexOf('/** Get message in the given language'));

const TUTEO = /\b(?:te|ti|tu|tus|contigo|tienes|quieres|prefieres|deseas|puedes|dime|cuéntame|disculpa|confirma|toca|agenda tu|dinos|avísame|escríbeme)\b/i;

describe('booking engine texts keep ONE register', () => {
    it('Spanish is usted from the first prompt to the last', () => {
        const lines = es.split('\n').filter(line => TUTEO.test(line));
        expect(lines.map(line => line.trim())).toEqual([]);
    });

    it('has the usted forms, not their tú twins', () => {
        for (const expected of ['¿Qué fecha le queda bien?', '¿Cuál es su nombre completo?', 'su correo electrónico', 'Por favor confirme', 'Cuénteme', 'Dígame qué día le queda mejor']) {
            expect(es).toContain(expected);
        }
    });

    it('Portuguese uses você, not the informal "te"', () => {
        expect(pt.split('\n').filter(line => /\b(?:te|ti|teu|tua|contigo)\b/i.test(line)).map(line => line.trim())).toEqual([]);
    });

    it('French uses vous, not tu/te/ton', () => {
        expect(fr.split('\n').filter(line => /\b(?:tu|te|ton|ta|tes|toi)\b/i.test(line)).map(line => line.trim())).toEqual([]);
    });
});
