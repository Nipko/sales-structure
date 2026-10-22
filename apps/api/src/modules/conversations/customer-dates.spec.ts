import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeForIntent, TurnContext } from '@parallext/shared';
import { customerDatesIn } from './date-reference';
import { PromptAssemblerService } from './prompt-assembler.service';

/**
 * F4300-18. A hotel guest asked on 2026-10-22 «¿hay disponibilidad para el 20 de noviembre una noche?» and the agent answered
 * «La fecha del 20 de noviembre ya pasó»; told «20 de noviembre de 2025», it answered «es válida». No tool ran: the model did
 * the calendar arithmetic on <now> by itself and got it backwards. The days a message names now reach <turn> already resolved
 * (iso, weekday, past/today/future) for every vertical, by the same reader the booking and reschedule paths use.
 */

const TODAY = '2026-10-22'; // a Thursday
const read = (text: string, today = TODAY) => customerDatesIn(normalizeForIntent(text), today);

describe('customerDatesIn: the days the current message names, as facts', () => {
    it('«20 de noviembre» said on 2026-10-22 is a future Friday this year, not a passed date', () => {
        expect(read('hay disponibilidad para el 20 de noviembre una noche?')).toEqual([
            { date: '2026-11-20', weekday: 'Friday', relation: 'future', yearStated: false },
        ]);
    });

    it('«20 de noviembre de 2025» is past, with the year the customer stated', () => {
        expect(read('20 de noviembre de 2025')).toEqual([
            { date: '2025-11-20', weekday: 'Thursday', relation: 'past', yearStated: true },
        ]);
    });

    it.each([
        ['pt', 'Tem disponibilidade para 20 de novembro, uma noite?'],
        ['en', 'Is there availability on November 20 for one night?'],
        ['fr', 'Avez-vous de la disponibilité le 20 novembre pour une nuit ?'],
    ])('reads the same day in %s', (_lang, text) => {
        expect(read(text)).toEqual([{ date: '2026-11-20', weekday: 'Friday', relation: 'future', yearStated: false }]);
    });

    it('knows the French «septembre / octobre / novembre» (they were missing from the month dictionary)', () => {
        expect(read('Une chambre pour le 30 octobre ?')).toEqual([{ date: '2026-10-30', weekday: 'Friday', relation: 'future', yearStated: false }]);
        expect(read('le 12 septembre 2027').map(d => [d.date, d.relation, d.yearStated])).toEqual([['2027-09-12', 'future', true]]);
    });

    it('a message with no date projects nothing', () => {
        expect(read('Hola, ¿qué tipos de habitación tienen y cuánto cuesta la noche?')).toEqual([]);
        expect(read('somos 2 personas')).toEqual([]);
    });

    it('keeps the rollover of explicitDates: a far year-less day that passed is this year\'s, past, with next year\'s offered back', () => {
        expect(read('¿tienen cupo para el 3 de julio?')).toEqual([
            { date: '2026-07-03', weekday: 'Friday', relation: 'past', yearStated: false, nextYearDate: '2027-07-03' },
        ]);
    });

    it('keeps the rollover of explicitDates: a near year-less day that passed is next year\'s, assumed', () => {
        expect(read('¿hay habitación para el 5 de enero?', '2026-12-20')).toEqual([
            { date: '2027-01-05', weekday: 'Tuesday', relation: 'future', yearStated: false, yearAssumed: true },
        ]);
    });

    it('a check-in and check-out range yields both days, in order', () => {
        expect(read('del 20 de noviembre al 22 de noviembre').map(d => d.date)).toEqual(['2026-11-20', '2026-11-22']);
    });

    it('resolves the relative days the existing readers already know', () => {
        expect(read('¿tienen algo para mañana?')).toEqual([{ date: '2026-10-23', weekday: 'Friday', relation: 'future', yearStated: false }]);
        expect(read('¿hay habitación para hoy?')).toEqual([{ date: TODAY, weekday: 'Thursday', relation: 'today', yearStated: false }]);
        expect(read('¿y el viernes?')).toEqual([{ date: '2026-10-23', weekday: 'Friday', relation: 'future', yearStated: false }]);
        // A weekday said on that same weekday is the next one, unless the customer says «hoy».
        expect(read('¿tienen el jueves?').map(d => d.date)).toEqual(['2026-10-29']);
        expect(read('¿para el viernes 30?')).toEqual([{ date: '2026-10-30', weekday: 'Friday', relation: 'future', yearStated: false }]);
    });

    it('an explicit date wins over a relative word in the same message', () => {
        expect(read('mañana le confirmo, pero quería el 20 de noviembre').map(d => d.date)).toEqual(['2026-11-20']);
    });
});

describe('<customer_dates> in the turn layer', () => {
    const service = new PromptAssemblerService({ buildSystemPrompt: jest.fn(() => '<persona />') } as any);
    const BASE: TurnContext = { language: 'es', timezone: 'America/Bogota', now: '2026-10-22T15:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open' };
    const CONFIG = { tools: {} } as any;

    it('renders one <date> per resolved day, outside the cacheable prefix', () => {
        const turn: TurnContext = { ...BASE, customerDates: [...read('el 20 de noviembre'), ...read('20 de noviembre de 2025'), ...read('el 3 de julio')] };
        const { systemPrompt, cachePrefixChars } = service.assembleWithCacheBoundary(CONFIG, turn);
        const tail = systemPrompt.slice(cachePrefixChars);
        expect(tail).toContain('<customer_dates>');
        expect(tail).toContain('<date iso="2026-11-20" weekday="Friday" relation="future" year_stated="false" />');
        expect(tail).toContain('<date iso="2025-11-20" weekday="Thursday" relation="past" year_stated="true" />');
        expect(tail).toContain('<date iso="2026-07-03" weekday="Friday" relation="past" year_stated="false" next_year_iso="2027-07-03" />');
        expect(systemPrompt.slice(0, cachePrefixChars)).not.toContain('<customer_dates>');
    });

    it('renders nothing when the message named no day', () => {
        expect(service.assembleWithCacheBoundary(CONFIG, { ...BASE }).systemPrompt).not.toContain('<customer_dates>');
        expect(service.assembleWithCacheBoundary(CONFIG, { ...BASE, customerDates: [] }).systemPrompt).not.toContain('<customer_dates>');
    });

    it('the conversation turn fills it from the current message and the tenant\'s local today, before assembling', () => {
        const src = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const fill = src.indexOf("customerDatesIn(normalizeForIntent(userText), new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now))");
        const assembly = [...src.matchAll(/assembleWithCacheBoundary\(/g)].map(m => m.index as number);
        expect(fill).toBeGreaterThan(-1);
        for (const at of assembly) expect(at).toBeGreaterThan(fill);
    });
});
