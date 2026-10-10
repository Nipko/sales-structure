import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { IntentInterpreterService } from './intent-interpreter.service';
import { resolveBusinessWindow, disambiguateBareHour } from './business-window';

/**
 * Regresion 5-oct, part 2: the agent denied the price of products that have one,
 * because prompt rule 22a said only priceStatus="confirmed" gives an amount and
 * the product tools never returned a priceStatus.
 */
describe('product tools carry priceStatus (regresion 5-oct)', () => {
    const row = (price: unknown) => ({
        id: 'p1', name: 'Audífono QA Aurora', description: null, category: 'audio', price, currency: 'COP',
        stock: 3, is_available: true, images: [], requires_prescription: false,
    });
    const executor = (rows: any[]) => {
        const e: any = Object.create(AIToolExecutorService.prototype);
        e.logger = { warn: jest.fn() };
        e.prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) };
        return e;
    };

    it.each([
        ['getProduct', (e: any) => e.getProduct('tenant_x', 'Audífono QA Aurora'), (r: any) => r],
        ['checkStock', (e: any) => e.checkStock('tenant_x', 'Audífono QA Aurora'), (r: any) => r],
        ['searchProducts', (e: any) => e.searchProducts('tenant_x', 'audifono'), (r: any) => r.products[0]],
    ])('%s: price > 0 is confirmed', async (_name, call, pick) => {
        const result = pick(await call(executor([row('129900.00')])));
        expect(result.price).toBe(129900);
        expect(result.priceStatus).toBe('confirmed');
    });

    it.each([
        ['getProduct', (e: any) => e.getProduct('tenant_x', 'Audífono QA Aurora'), (r: any) => r],
        ['checkStock', (e: any) => e.checkStock('tenant_x', 'Audífono QA Aurora'), (r: any) => r],
        ['searchProducts', (e: any) => e.searchProducts('tenant_x', 'audifono'), (r: any) => r.products[0]],
    ])('%s: no price is never confirmed', async (_name, call, pick) => {
        for (const price of [0, null, '0.00']) {
            expect(pick(await call(executor([row(price)]))).priceStatus).not.toBe('confirmed');
        }
    });
});

describe('prompt: product price and handoff wording (regresion 5-oct)', () => {
    const prompt = readFileSync(resolve(__dirname, 'prompt-assembler.service.ts'), 'utf8');

    it('22a scopes the priceStatus rule to services and tells the model to call the product tool this turn', () => {
        const rule = prompt.slice(prompt.indexOf('22a. NO NUMBER WITHOUT'), prompt.indexOf('22. NEVER CONVERT'));
        expect(rule).toContain('SERVICE tool result whose priceStatus is present');
        expect(rule).toContain('get_product or check_stock in THIS turn');
        expect(rule).toContain('never take it from the conversation history');
    });

    it('rule 25 no longer teaches a literal transfer sentence and only announces after acceptance', () => {
        const rule = prompt.slice(prompt.indexOf('25. NO WAITING PHRASES'), prompt.indexOf('25b. FALLBACK'));
        expect(rule).not.toContain('Le paso con nuestro equipo');
        expect(rule).not.toContain('I will transfer you to our team');
        expect(rule).toContain('ONLY when the customer accepted it in their CURRENT message');
    });
});

describe('UNVERIFIED_CLAIM_FALLBACK is honest and offers a person as a question', () => {
    const src = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
    const block = src.slice(src.indexOf('const UNVERIFIED_CLAIM_FALLBACK'), src.indexOf('const unverifiedClaimFallbackText'));
    it('does not promise to verify "in a moment" in any language', () => {
        expect(block).not.toMatch(/Déjame verificarlo|Let me check|Vou verificar|Je vérifie/);
    });
    it.each(['es', 'en', 'pt', 'fr'])('%s: ends in an offer question', lang => {
        const line = block.split('\n').find(l => l.trim().startsWith(lang + ':'))!;
        expect(line).toBeTruthy();
        expect(line).toMatch(/\?['"`]?,?\s*$/);
    });
});

describe('"a las 4" is the afternoon only when the hours say so (minor, regresion 5-oct)', () => {
    const upcoming = [{ date: '2026-10-10', weekday: 'Saturday' }];
    const schedule = { saturday: { enabled: true, open: '09:00', close: '19:00' } };
    const windowFor = (d: string) => resolveBusinessWindow({ schedule }, undefined, d);
    const interpret = (text: string, resolver?: any) => {
        const svc = new IntentInterpreterService({ execute: jest.fn() } as any);
        return svc.interpret(text, 'idle', ['Corte y estilo'], '2026-10-05', upcoming, 't', undefined, undefined, resolver);
    };

    it('bare 4 outside the hours with 16:00 inside becomes 16:00', async () => {
        expect((await interpret('¿hay cupo este sábado a las 4 para corte?', windowFor)).timeMentioned).toBe('16:00');
    });
    it.each([
        ['a las 4 de la mañana', '04:00'],
        ['a las 4 am', '04:00'],
        ['a las 4 de la tarde', '16:00'],
        ['a las 4 pm', '16:00'],
    ])('keeps an explicit qualifier: %s', async (tail, expected) => {
        expect((await interpret('este sábado ' + tail, windowFor)).timeMentioned).toBe(expected);
    });
    it('without known hours nothing changes', async () => {
        expect((await interpret('¿hay cupo este sábado a las 4 para corte?')).timeMentioned).toBe('04:00');
        expect((await interpret('¿hay cupo este sábado a las 4 para corte?', () => null)).timeMentioned).toBe('04:00');
    });
    it('an hour already inside the window is untouched, and so is one outside both readings', async () => {
        expect(disambiguateBareHour(10, 0, { openMin: 540, closeMin: 1140 })).toBe(10);
        expect(disambiguateBareHour(4, 0, { openMin: 540, closeMin: 900 })).toBe(4);
        expect(disambiguateBareHour(8, 0, { openMin: 540, closeMin: 1140 })).toBe(8);
        expect(disambiguateBareHour(4, 0, { openMin: 180, closeMin: 1140 })).toBe(4);
    });
    it('a closed day yields no window', () => {
        expect(resolveBusinessWindow({ schedule: { saturday: { enabled: false } } }, undefined, '2026-10-10')).toBeNull();
    });
});

describe('the hours derived from the agenda feed the "a las 4" resolver (regresion2)', () => {
    const informational = (rows: Record<string, any>) => ({ informational: true, source: 'appointment_availability', is247: false, schedule: rows });
    const nineToSeven = informational({
        saturday: { windows: [{ open: '09:00', close: '19:00' }] },
        sunday: { enabled: false },
    });

    it('uses the derived agenda when nothing else is configured', () => {
        expect(resolveBusinessWindow(null, undefined, '2026-10-10', nineToSeven)).toEqual({ openMin: 540, closeMin: 1140 });
    });
    it('takes the earliest opening and the latest closing of a split day', () => {
        for (const windows of [
            [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '18:00' }],
            [{ open: '14:00', close: '18:00' }, { open: '09:00', close: '12:00' }],
        ]) {
            const split = informational({ saturday: { windows } });
            expect(resolveBusinessWindow(null, undefined, '2026-10-10', split)).toEqual({ openMin: 540, closeMin: 1080 });
        }
    });
    it('a day without windows, an unknown agenda or no agenda yield nothing', () => {
        expect(resolveBusinessWindow(null, undefined, '2026-10-11', nineToSeven)).toBeNull();
        expect(resolveBusinessWindow(null, undefined, '2026-10-10', { informational: true, unknown: true, schedule: {} } as any)).toBeNull();
        expect(resolveBusinessWindow(null, undefined, '2026-10-10', null)).toBeNull();
        expect(resolveBusinessWindow(null, undefined, '2026-10-10')).toBeNull();
    });
    it('configured hours always win over the agenda', () => {
        const configured = { schedule: { saturday: { enabled: true, open: '10:00', close: '14:00' } } };
        expect(resolveBusinessWindow(configured, undefined, '2026-10-10', nineToSeven)).toEqual({ openMin: 600, closeMin: 840 });
        const agent = { schedule: { sab: { enabled: true, open: '11:00', close: '15:00' } } };
        expect(resolveBusinessWindow(null, agent, '2026-10-10', nineToSeven)).toEqual({ openMin: 660, closeMin: 900 });
        expect(resolveBusinessWindow({ is247: true }, undefined, '2026-10-10', nineToSeven)).toBeNull();
        expect(resolveBusinessWindow({ schedule: { saturday: { enabled: false } } }, undefined, '2026-10-10', nineToSeven)).toBeNull();
    });
});

describe('the period qualifier of "a las N" needs a word boundary (regresion2)', () => {
    const upcoming = [{ date: '2026-10-10', weekday: 'Saturday' }, { date: '2026-10-06', weekday: 'Tuesday' }];
    const window = () => ({ openMin: 540, closeMin: 1140 });
    const interpret = (text: string) => new IntentInterpreterService({ execute: jest.fn() } as any)
        .interpret(text, 'idle', ['Corte y estilo'], '2026-10-05', upcoming, 't', undefined, undefined, window);

    it.each([
        '¿Tienen cupo el sábado a las 4 para corte?',
        'mañana a las 4 hay espacio?',
        'el sábado a las 4 hay cupo',
        'el sábado a las 4 hoy no, hmm',
    ])('"%s" is 16:00', async text => {
        expect((await interpret(text)).timeMentioned).toBe('16:00');
    });
    it.each([
        ['el sábado a las 4h', '04:00'],
        ['el sábado a las 4 hs', '04:00'],
        ['el sábado a las 4 hrs', '04:00'],
        ['el sábado a las 16h', '16:00'],
        ['el sábado a las 4pm', '16:00'],
        ['el sábado a las 4 pm.', '16:00'],
        ['el sábado a las 4 de la tarde?', '16:00'],
        ['el sábado a las 4 am', '04:00'],
        ['el sábado a las 4 de la mañana', '04:00'],
    ])('a real qualifier still counts: %s', async (text, expected) => {
        expect((await interpret(text)).timeMentioned).toBe(expected);
    });
});

describe('a partial product name resolves when it identifies a single product (regresion2)', () => {
    const row = { id: 'p1', name: 'Audífono QA Aurora', description: null, category: 'audio', price: '119900', currency: 'COP',
        stock: 3, is_available: true, images: [], requires_prescription: false };
    const executor = (...answers: any[][]) => {
        const e: any = Object.create(AIToolExecutorService.prototype);
        e.logger = { warn: jest.fn() };
        const query = jest.fn();
        for (const rows of answers) query.mockResolvedValueOnce(rows);
        e.prisma = { $queryRawUnsafe: query };
        return e;
    };

    it.each([
        ['getProduct', (e: any) => e.getProduct('tenant_x', 'QA Aurora')],
        ['checkStock', (e: any) => e.checkStock('tenant_x', 'QA Aurora')],
    ])('%s falls back to containment when the exact name finds nothing and one product matches', async (_name, call) => {
        const e = executor([], [row]);
        const result = await call(e);
        expect(result).toMatchObject({ id: 'p1', price: 119900, priceStatus: 'confirmed' });
        const fallback = String(e.prisma.$queryRawUnsafe.mock.calls[1][0]);
        expect(fallback).toMatch(/is_available = true/);
        expect(fallback).toMatch(/LIKE/);
        // one pattern per significant word (a plural or a word left out of the name still finds it): see catalog-search-tolerant.spec.ts
        expect(e.prisma.$queryRawUnsafe.mock.calls[1].slice(1)).toEqual(['%qa%', '%aurora%']);
    });

    it.each([
        ['getProduct', (e: any) => e.getProduct('tenant_x', 'Aurora')],
        ['checkStock', (e: any) => e.checkStock('tenant_x', 'Aurora')],
    ])('%s never guesses between two candidates', async (_name, call) => {
        const ambiguous = await call(executor([], [row, { ...row, id: 'p2' }]));
        expect(ambiguous.id).toBeUndefined();
        expect(ambiguous.product ?? null).toBeNull();
    });

    it('matches whole words only and needs four characters: "urora" is not inside "Aurora"', async () => {
        const stub = executor([], [row]);
        expect((await (stub as any).getProduct('tenant_x', 'urora')).id).toBeUndefined();
        const tiny = executor([]);
        await (tiny as any).getProduct('tenant_x', 'ora');
        expect(tiny.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect((await (executor([], [row]) as any).getProduct('tenant_x', 'qa aurora')).id).toBe('p1');
        expect((await (executor([], [row]) as any).getProduct('tenant_x', 'AUDIFONO')).id).toBe('p1');
    });

    it('an exact hit does not run the fallback, and a uuid never does', async () => {
        const exact = executor([row]);
        await (exact as any).getProduct('tenant_x', 'Audífono QA Aurora');
        expect(exact.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        const uuid = executor([]);
        await (uuid as any).getProduct('tenant_x', '11111111-1111-4111-8111-111111111111');
        expect(uuid.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        const short = executor([]);
        await (short as any).getProduct('tenant_x', 'ab');
        expect(short.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });
});
