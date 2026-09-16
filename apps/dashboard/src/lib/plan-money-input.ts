/** Parse major currency units without discarding signs, suffixes or decimals. */
export function parsePlanMoney(raw: string, locale: string): number | null {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    const group = parts.find(p => p.type === 'group')?.value ?? ',';
    const decimal = parts.find(p => p.type === 'decimal')?.value ?? '.';
    const value = raw.trim().replace(/[\u00a0\u202f]/g, ' ');
    const separator = group.replace(/[\u00a0\u202f]/g, ' ');
    const pieces = value.split(decimal);
    if (pieces.length > 2 || (pieces.length === 2 && !/^\d{1,2}$/.test(pieces[1]))) return null;
    const whole = pieces[0];
    const groups = whole.split(separator);
    if (!/^\d+$/.test(groups[0]) || (groups.length > 1 && (groups[0].length > 3
        || groups.slice(1).some(g => !/^\d{3}$/.test(g))))) return null;
    const cents = Number(groups.join('')) * 100 + Number((pieces[1] ?? '').padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents >= 0 && cents <= 2147483647 ? cents : null;
}
