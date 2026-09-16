import { parsePlanMoney } from './plan-money-input';
describe('plan money input', () => {
    it.each([['129.900,50','es-CO',12990050], ['129,900.50','en',12990050],
        ['129\u202f900,50','fr',12990050], ['29.00','en',2900], ['0','es',0]])(
        'preserves cents in %s', (raw, locale, cents) => expect(parsePlanMoney(raw,locale)).toBe(cents));
    it.each(['-29','29oops','', '1.23.456','1e5','999999999999999999999','29,999']) (
        'rejects malformed prices rather than saving zero: %s', raw => expect(parsePlanMoney(raw,'es-CO')).toBeNull());
});
