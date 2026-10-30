/**
 * Aceptación R1 #2, #4 y #5 sobre las fotos golden de los 7 tenants QA (exportadas de la base de producción
 * con SELECT de solo lectura y contactos anonimizados; test/fixtures/qa-tenants/*.snapshot.json).
 *
 * #2 Dental y comida reproducen validacion-dental-comida.md (corregida a v0.2): mismo veredicto y mismo conjunto
 *    de bloqueantes que fallan. Diferencias intencionales con la validación manual (documentadas en el informe R1):
 *    - aplicables: dental 57 (= 56 + CORE.KNOWLEDGE.AGENT_INSTRUCTIONS, nuevo en v0.2); comida 56 (−WARRANTY por D-13,
 *      +AGENT_INSTRUCTIONS).
 *    - CORE.SAFETY.EMERGENCY_BASE (dental) sigue fallando y bloqueando, pero su hueco se muestra en
 *      CORE.IDENTITY.REGION (causa raíz, D-17).
 */
import * as fs from 'node:fs';
import { evaluate } from '../src/engine/evaluate';
import { fromLegacyRows } from '../src/legacy-status';
import { FIXTURES, NOW, fixtureRows, fixtureSnapshot, spec } from './helpers';

const DENTAL_BLOCKING = [
    'CORE.IDENTITY.REGION', 'CORE.LOCATIONS.LIST', 'CORE.HOURS.REGULAR', 'CORE.OFFER.ITEMS', 'CORE.OFFER.PRICE_MODEL',
    'CORE.PAYMENT.METHODS', 'CORE.POLICY.CANCELLATION_CHANGES', 'CORE.PRIVACY.NOTICE', 'CORE.HANDOFF.HOURS_SLA',
    'CORE.SAFETY.EMERGENCY_BASE', 'OBJ.APPOINTMENT.CATALOG', 'OBJ.APPOINTMENT.AVAILABILITY_SOURCE', 'OBJ.APPOINTMENT.WRITE_MODE',
    'OBJ.APPOINTMENT.CHANGE_RULES', 'OBJ.APPOINTMENT.ACCOUNT_READ', 'DOM.HEALTH.EMERGENCY_PROTOCOL', 'DOM.HEALTH.CLINICAL_SCOPE',
    'DOM.HEALTH.SENSITIVE_DATA',
];
const DENTAL_BLOCKING_PASS = ['CORE.IDENTITY.NAME', 'CORE.IDENTITY.DESCRIPTION', 'CORE.IDENTITY.PROFILE', 'CORE.HANDOFF.TEAM'];
const FOOD_BLOCKING = [
    'CORE.IDENTITY.REGION', 'CORE.LOCATIONS.LIST', 'CORE.SERVICE_AREA', 'CORE.DELIVERY.TERMS', 'CORE.HOURS.REGULAR',
    'CORE.PAYMENT.METHODS', 'CORE.PRIVACY.NOTICE', 'CORE.HANDOFF.HOURS_SLA', 'OBJ.FOOD_ORDER.CATALOG',
    'OBJ.FOOD_ORDER.AVAILABILITY_SOURCE', 'OBJ.FOOD_ORDER.WRITE_MODE', 'OBJ.FOOD_ORDER.CHANGE_RULES', 'OBJ.FOOD_ORDER.ALLERGENS_DIET',
];
const FOOD_BLOCKING_PASS = ['CORE.IDENTITY.NAME', 'CORE.IDENTITY.DESCRIPTION', 'CORE.IDENTITY.PROFILE', 'CORE.OFFER.ITEMS', 'CORE.OFFER.PRICE_MODEL', 'CORE.HANDOFF.TEAM'];

const passing = (r: ReturnType<typeof evaluate>, ids: string[]) => ids.filter(id => r.requirements.find(x => x.id === id)?.result === 'cumple');

describe('golden: validación manual dental y comida', () => {
    it('dental (P08 · appointment · health): no listo, 22 bloqueantes aplicables, los mismos 18 fallan', () => {
        const r = evaluate(spec, fixtureSnapshot('spark-qa-dental-03'));
        expect(r.config).toMatchObject({ profileId: 'P08', subtype: 'salud/dental', domains: ['health'] });
        expect(r.config.objects).toEqual([{ object: 'appointment', variant: null, writeMode: 'direct_commit', writeModeDeclared: false }]);
        expect(r.verdict).toBe('no_listo');
        expect(r.counts).toMatchObject({ applicable: 57, blocking: 22, blockingFailing: 18 });
        expect([...r.blockingGaps].sort()).toEqual([...DENTAL_BLOCKING].sort());
        expect(passing(r, DENTAL_BLOCKING_PASS)).toEqual(DENTAL_BLOCKING_PASS);
        const emergency = r.requirements.find(x => x.id === 'CORE.SAFETY.EMERGENCY_BASE');
        expect(emergency?.gap?.rootCause).toBe('CORE.IDENTITY.REGION');
        expect(r.requirements.find(x => x.id === 'CORE.IDENTITY.REGION')?.gap?.rootOf).toContain('CORE.SAFETY.EMERGENCY_BASE');
        expect(r.requirements.find(x => x.id === 'CORE.HOURS.REGULAR')?.gap?.message).toBe('Confirma tu horario de cada día.'); // D-12
        expect(r.requirements.find(x => x.id === 'CORE.OFFER.ITEMS')?.gap?.cause).toBe('sembrado');
        expect(r.requirements.find(x => x.id === 'CORE.OFFER.PRICE_MODEL')?.gap?.message).toMatch(/^3 precios siguen siendo de ejemplo/);
        expect(r.requirements.find(x => x.id === 'PROF.P09.PREPARATIONS')?.result).toBe('no_cumple'); // D-10: ya no cumple vacuamente
    });

    it('comida (P02 · food_order(delivery)): no listo, 19 bloqueantes aplicables, los mismos 13 fallan', () => {
        const r = evaluate(spec, fixtureSnapshot('spark-qa-comida-04'));
        expect(r.config).toMatchObject({ profileId: 'P02', subtype: 'restaurantes/comida_rapida', domains: [] });
        expect(r.config.objects).toEqual([{ object: 'food_order', variant: 'delivery', writeMode: 'direct_commit', writeModeDeclared: false }]);
        expect(r.verdict).toBe('no_listo');
        expect(r.counts).toMatchObject({ applicable: 56, blocking: 19, blockingFailing: 13 });
        expect([...r.blockingGaps].sort()).toEqual([...FOOD_BLOCKING].sort());
        expect(passing(r, FOOD_BLOCKING_PASS)).toEqual(FOOD_BLOCKING_PASS);
        expect(r.requirements.find(x => x.id === 'CORE.POLICY.WARRANTY')?.applies).toBe(false); // D-13
        expect(r.requirements.find(x => x.id === 'CORE.POLICY.CANCELLATION_CHANGES')?.applies).toBe(false);
        expect(r.requirements.find(x => x.id === 'OBJ.FOOD_ORDER.AVAILABILITY_SOURCE')?.gap?.message).toBe('Confirma cómo marcas un plato como agotado.'); // D-16
    });

    it('los huecos de plataforma no bajan el estado del tenant (D-18) y los derivados no generan hueco propio (D-11)', () => {
        const r = evaluate(spec, fixtureSnapshot('spark-qa-dental-03'));
        expect(r.platformGaps.map(p => p.id)).toContain('CORE.PROC.FOLLOW_UP_STATE');
        expect(r.blockingGaps).not.toContain('CORE.PROC.OFFER_ACCEPTANCE');
        expect(r.requirements.find(x => x.id === 'CORE.PROC.OFFER_ACCEPTANCE')).toMatchObject({ derived: true, result: 'no_cumple' });
    });
});

describe('golden: los 7 tenants QA', () => {
    const slugs = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.snapshot.json')).map(f => f.replace('.snapshot.json', '')).sort();

    it('hay 7 fotos, sin contactos reales', () => {
        expect(slugs).toHaveLength(7);
        for (const slug of slugs) {
            const text = fs.readFileSync(`${FIXTURES}/${slug}.snapshot.json`, 'utf8');
            expect(text).not.toMatch(/password|secret|token/i);
            for (const email of text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) expect(email).toMatch(/@example\.test$/);
        }
    });

    it.each(slugs)('%s: la misma foto da el mismo resultHash y tarda < 5 s', slug => {
        const t0 = Date.now();
        const a = evaluate(spec, fromLegacyRows(fixtureRows(slug)), NOW);
        const elapsed = Date.now() - t0;
        const b = evaluate(spec, JSON.parse(JSON.stringify(fromLegacyRows(fixtureRows(slug)))), NOW);
        expect(b.resultHash).toBe(a.resultHash);
        expect(b.snapshotHash).toBe(a.snapshotHash);
        expect(elapsed).toBeLessThan(5000);
        expect(['no_listo', 'limitado', 'listo']).toContain(a.verdict);
    });

    it('otra hora puede dar otro resultado, pero la misma hora siempre el mismo', () => {
        const snap = fixtureSnapshot('spark-qa-hotel-09');
        expect(evaluate(spec, snap, NOW).resultHash).toBe(evaluate(spec, snap, NOW).resultHash);
        expect(evaluate(spec, snap, NOW).asOf).toBe(NOW.toISOString());
    });
});
