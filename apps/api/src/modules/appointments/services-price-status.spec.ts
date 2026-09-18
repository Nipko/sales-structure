import { BadRequestException } from '@nestjs/common';
import { ServicesService, assertPaymentPolicyNeedsConfirmedPrice, resolvePriceStatusInput } from './services.service';

/**
 * D10 (sep-2026): a recipe seeds services with EXAMPLE prices so a new owner
 * has something to start from. "Usar así" never confirms a price: the owner
 * confirms by typing one, by pressing "Confirmar precio", or declares the
 * service quote-only. Until then the agent states no number, and no payment
 * policy may be built on the example amount.
 */
function subject(rows: Record<string, any[]>) {
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, _params?: any[]): Promise<any[]> => {
        if (sql.startsWith('SELECT * FROM services WHERE id')) return rows.current;
        return [];
    });
    const redis = { del: jest.fn().mockResolvedValue(undefined) };
    const events = { emit: jest.fn() };
    const service = new ServicesService({ executeInTenantSchema } as any, redis as any, events as any);
    return { service, executeInTenantSchema };
}

const EXAMPLE_ROW = {
    id: '11111111-1111-4111-8111-111111111111', name: 'Corte y estilo', description: null, duration_minutes: 45,
    duration_minutes_max: null, duration_type: 'fixed', buffer_minutes: 0, price: '40000', currency: 'COP', color: '#6c5ce7',
    is_active: true, sort_order: 0, category: 'corte', max_concurrent: 1, rebook_after_days: null, required_fields: [],
    payment_policy: 'none', deposit_percent: null, deposit_amount: null, price_status: 'example',
};

describe('the owner decides what a price is', () => {
    it('a typed price is a confirmation on its own', () => {
        expect(resolvePriceStatusInput({ price: 50000 })).toBe('confirmed');
        expect(resolvePriceStatusInput({ price: 0 })).toBe('confirmed');
    });
    it('keeps the current provenance when nothing about the price was said', () => {
        expect(resolvePriceStatusInput({ name: 'Otro nombre' }, { priceStatus: 'example' })).toBe('example');
        expect(resolvePriceStatusInput({}, { priceStatus: 'quote' })).toBe('quote');
        expect(resolvePriceStatusInput({})).toBe('confirmed');
    });
    it('accepts confirmed or quote, never a claim of "example"', () => {
        expect(resolvePriceStatusInput({ priceStatus: 'quote' })).toBe('quote');
        expect(resolvePriceStatusInput({ priceStatus: 'confirmed' }, { priceStatus: 'example', price: 50000 })).toBe('confirmed');
        expect(() => resolvePriceStatusInput({ priceStatus: 'example' })).toThrow(BadRequestException);
        expect(() => resolvePriceStatusInput({ priceStatus: 'anything' })).toThrow(BadRequestException);
    });

    it('refuses to confirm a price that does not exist', () => {
        // D17 siembra la fila SIN monto fuera de los seis países con ejemplo.
        // "Confirmar precio" conservaba "el mismo número" —que era ninguno— y
        // lo guardaba como confirmado: el servicio pasaba a valer 0 y el agente
        // empezaba a decirle al cliente que es gratis. El dueño solo tocó un
        // botón que decía confirmar.
        expect(() => resolvePriceStatusInput({ priceStatus: 'confirmed' }, { priceStatus: 'example', price: null }))
            .toThrow(BadRequestException);
        // Escribir el monto sí confirma, que es el camino que la pantalla ofrece.
        expect(resolvePriceStatusInput({ priceStatus: 'confirmed', price: 90000 }, { priceStatus: 'example', price: null }))
            .toBe('confirmed');
        // Y "se cotiza" sigue disponible: es la respuesta correcta cuando no
        // hay un número que poner.
        expect(resolvePriceStatusInput({ priceStatus: 'quote' }, { priceStatus: 'example', price: null }))
            .toBe('quote');
    });
});

describe('the till never sees an unconfirmed price', () => {
    it('allows no policy on any status and any policy on a confirmed price', () => {
        expect(() => assertPaymentPolicyNeedsConfirmedPrice('none', 'example')).not.toThrow();
        expect(() => assertPaymentPolicyNeedsConfirmedPrice('none', 'quote')).not.toThrow();
        expect(() => assertPaymentPolicyNeedsConfirmedPrice('deposit', 'confirmed')).not.toThrow();
    });
    it('refuses a deposit or full payment on an example or quote-only price', () => {
        for (const policy of ['deposit', 'full', 'any']) {
            expect(() => assertPaymentPolicyNeedsConfirmedPrice(policy, 'example')).toThrow(BadRequestException);
            expect(() => assertPaymentPolicyNeedsConfirmedPrice(policy, 'quote')).toThrow(BadRequestException);
        }
    });
});

describe('ServicesService writes the provenance', () => {
    it('creates owner services as confirmed and stores the column', async () => {
        const { service, executeInTenantSchema } = subject({ current: [{ ...EXAMPLE_ROW, price_status: 'confirmed' }] });
        await service.create('tenant_test', { name: 'Corte', durationMinutes: 45, price: 40000 }, 'tenant');
        const [, sql, params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('INSERT INTO services'))! as [string, string, any[]];
        expect(sql).toContain('price_status');
        expect(params[params.length - 1]).toBe('confirmed');
    });
    it('lets the owner create a quote-only service', async () => {
        const { service, executeInTenantSchema } = subject({ current: [{ ...EXAMPLE_ROW, price_status: 'quote' }] });
        await service.create('tenant_test', { name: 'Evento', durationMinutes: 120, priceStatus: 'quote' }, 'tenant');
        const [, , params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('INSERT INTO services'))! as [string, string, any[]];
        expect(params[params.length - 1]).toBe('quote');
    });
    it('refuses to create a deposit-taking service on a quote-only price', async () => {
        const { service } = subject({ current: [] });
        await expect(service.create('tenant_test', { name: 'Evento', durationMinutes: 120, priceStatus: 'quote', paymentPolicy: 'deposit', depositPercent: 30 }, 'tenant'))
            .rejects.toMatchObject({ response: { error: 'price_not_confirmed' } });
    });
    it('"Confirmar precio" flips an example to confirmed without retyping the number', async () => {
        const { service, executeInTenantSchema } = subject({ current: [EXAMPLE_ROW] });
        await service.update('tenant_test', EXAMPLE_ROW.id, { priceStatus: 'confirmed' }, 'tenant');
        const [, sql, params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('UPDATE services'))! as [string, string, any[]];
        expect(sql).toContain('price_status = $1');
        expect(sql).not.toContain('price = $');
        expect(params[0]).toBe('confirmed');
    });
    it('editing the number confirms it', async () => {
        const { service, executeInTenantSchema } = subject({ current: [EXAMPLE_ROW] });
        await service.update('tenant_test', EXAMPLE_ROW.id, { price: 45000 }, 'tenant');
        const [, sql, params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('UPDATE services'))! as [string, string, any[]];
        expect(sql).toContain('price = $1');
        expect(sql).toContain('price_status = $2');
        expect(params.slice(0, 2)).toEqual([45000, 'confirmed']);
    });
    it('resending the same example number from the editor does not confirm it', async () => {
        // The editor spreads the whole form into the PUT, so the untouched
        // example amount comes back with every unrelated edit.
        const { service, executeInTenantSchema } = subject({ current: [EXAMPLE_ROW] });
        await service.update('tenant_test', EXAMPLE_ROW.id, { price: 40000, durationMinutes: 60 }, 'tenant');
        const [, sql] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('UPDATE services'))! as [string, string, any[]];
        expect(sql).toContain('price = $');
        expect(sql).not.toContain('price_status');
    });
    it('keeping a paying policy re-checks the row at write time (two editors can race)', async () => {
        const confirmedWithDeposit = { ...EXAMPLE_ROW, price_status: 'confirmed', payment_policy: 'deposit', deposit_percent: 30 };
        const { service, executeInTenantSchema } = subject({ current: [confirmedWithDeposit] });
        executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => sql.startsWith('SELECT * FROM services WHERE id') ? [confirmedWithDeposit] : (sql.startsWith('UPDATE services') ? [{ id: EXAMPLE_ROW.id }] : []));
        await service.update('tenant_test', EXAMPLE_ROW.id, { name: 'Corte premium' }, 'tenant');
        const [, sql] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('UPDATE services'))! as [string, string, any[]];
        expect(sql).toContain("AND COALESCE(price_status, 'confirmed') = 'confirmed'");
        expect(sql).toContain('RETURNING id');
        // The other editor flipped it to quote between our read and our write.
        const racing = subject({ current: [confirmedWithDeposit] });
        await expect(racing.service.update('tenant_test', EXAMPLE_ROW.id, { name: 'Corte premium' }, 'tenant'))
            .rejects.toMatchObject({ response: { error: 'price_not_confirmed' } });
    });
    it('renaming an example service leaves the example mark alone', async () => {
        const { service, executeInTenantSchema } = subject({ current: [EXAMPLE_ROW] });
        await service.update('tenant_test', EXAMPLE_ROW.id, { name: 'Corte clásico' }, 'tenant');
        const [, sql] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('UPDATE services'))! as [string, string, any[]];
        expect(sql).not.toContain('price_status');
    });
    it('refuses a payment policy while the price is still an example', async () => {
        const { service } = subject({ current: [EXAMPLE_ROW] });
        await expect(service.update('tenant_test', EXAMPLE_ROW.id, { paymentPolicy: 'deposit', depositPercent: 30 }, 'tenant'))
            .rejects.toMatchObject({ response: { error: 'price_not_confirmed' } });
    });
    it('reads legacy rows (no column value) as confirmed', async () => {
        const { service } = subject({ current: [{ ...EXAMPLE_ROW, price_status: null }] });
        const row = await service.getById('tenant_test', EXAMPLE_ROW.id);
        expect(row.priceStatus).toBe('confirmed');
    });
});
