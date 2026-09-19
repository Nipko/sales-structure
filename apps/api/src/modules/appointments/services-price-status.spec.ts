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
        // Un servicio que se cotiza guarda 0 como "no hay número": confirmarlo
        // sin escribir el monto lo volvería gratis.
        expect(() => resolvePriceStatusInput({ priceStatus: 'confirmed' }, { priceStatus: 'quote', price: 0 }))
            .toThrow(BadRequestException);
        // El 0 de un ejemplo TAMPOCO es un precio (FX1-5). La receta pone 0 a
        // la clase de prueba, que es gratis, pero también a "Mensualidad de
        // clases grupales" y a "Clase personalizada", que no lo son: "Confirmar
        // precio" sobre ese 0 anunciaba gratis una mensualidad. Que es gratis
        // se dice con `free: true` ("Es gratis"), igual que en los planes.
        expect(() => resolvePriceStatusInput({ priceStatus: 'confirmed' }, { priceStatus: 'example', price: 0 }))
            .toThrow(BadRequestException);
        expect(resolvePriceStatusInput({ priceStatus: 'confirmed', price: 0, free: true }, { priceStatus: 'example', price: 0 }))
            .toBe('confirmed');
        // Y "se cotiza" sigue disponible: es la respuesta correcta cuando no
        // hay un número que poner.
        expect(resolvePriceStatusInput({ priceStatus: 'quote' }, { priceStatus: 'example', price: null }))
            .toBe('quote');
    });
});

describe('a 0 is free only when the owner says so (FX1-2, FX1-5)', () => {
    const priceMissing = (run: () => unknown) => {
        try { run(); } catch (error) {
            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).getResponse()).toMatchObject({ error: 'price_missing' });
            return;
        }
        throw new Error('expected price_missing');
    };

    it('the editor resending the placeholder 0 with "Precio confirmado" is not "free"', () => {
        // The form sends `price` on every save, and before FX1 the guard only
        // fired when no price was sent: a quote row's 0 came back as a price.
        priceMissing(() => resolvePriceStatusInput({ priceStatus: 'confirmed', price: 0 }, { priceStatus: 'quote', price: 0 }));
        priceMissing(() => resolvePriceStatusInput({ priceStatus: 'confirmed', price: 0 }, { priceStatus: 'example', price: null }));
        priceMissing(() => resolvePriceStatusInput({ priceStatus: 'confirmed', price: 0 }, { priceStatus: 'example', price: 0 }));
        priceMissing(() => resolvePriceStatusInput({ priceStatus: 'confirmed', price: '' }, { priceStatus: 'example', price: null }));
    });

    it('"Es gratis" is an explicit choice, accepted on every placeholder', () => {
        for (const current of [
            { priceStatus: 'quote' as const, price: 0 },
            { priceStatus: 'example' as const, price: null },
            { priceStatus: 'example' as const, price: 0 },
            { priceStatus: 'example' as const, price: 45000 },
        ]) {
            expect(resolvePriceStatusInput({ free: true }, current)).toBe('confirmed');
            expect(resolvePriceStatusInput({ priceStatus: 'confirmed', price: 0, free: true }, current)).toBe('confirmed');
        }
    });

    it('"Es gratis" cannot be combined with a number or with "se cotiza"', () => {
        expect(() => resolvePriceStatusInput({ free: true, price: 30000 }, { priceStatus: 'example', price: null })).toThrow(BadRequestException);
        expect(() => resolvePriceStatusInput({ free: true, priceStatus: 'quote' }, { priceStatus: 'example', price: null })).toThrow(BadRequestException);
        expect(() => resolvePriceStatusInput({ free: 'yes' }, { priceStatus: 'example', price: null })).toThrow(BadRequestException);
    });

    it('typing 0 over a real price is not a declaration either', () => {
        priceMissing(() => resolvePriceStatusInput({ price: 0 }, { priceStatus: 'example', price: 40000 }));
        priceMissing(() => resolvePriceStatusInput({ price: 0 }, { priceStatus: 'confirmed', price: 50000 }));
        expect(resolvePriceStatusInput({ price: 0, free: true }, { priceStatus: 'confirmed', price: 50000 })).toBe('confirmed');
    });

    it('a service that is already free stays free when the form comes back', () => {
        expect(resolvePriceStatusInput({ price: 0, name: 'Asesoría' }, { priceStatus: 'confirmed', price: 0 })).toBe('confirmed');
        expect(resolvePriceStatusInput({ priceStatus: 'confirmed', price: 0 }, { priceStatus: 'confirmed', price: 0 })).toBe('confirmed');
    });

    it('a new service may be created at a typed 0: there is no placeholder to confirm', () => {
        expect(resolvePriceStatusInput({ price: 0 })).toBe('confirmed');
        expect(resolvePriceStatusInput({ free: true })).toBe('confirmed');
    });
});

describe('a NULL price read from the database stays NULL (FX1-1)', () => {
    // D17 seeds the row WITHOUT an amount outside the six example countries.
    const NULL_EXAMPLE = { ...EXAMPLE_ROW, name: 'Consulta general', price: null, currency: 'UYU' };

    it('"Confirmar precio" on a seeded service with no amount is refused and writes nothing', async () => {
        // Before FX1 the unit guard was right and the service was not: `update`
        // read the row through mapRow, which turned NULL into 0, so the guard saw
        // a price. The row became confirmed with NULL and list_services said 0.
        const { service, executeInTenantSchema } = subject({ current: [NULL_EXAMPLE] });
        await expect(service.update('tenant_test', NULL_EXAMPLE.id, { priceStatus: 'confirmed' }, 'tenant'))
            .rejects.toMatchObject({ response: { error: 'price_missing' } });
        expect(executeInTenantSchema.mock.calls.some(([, sql]) => String(sql).startsWith('UPDATE services'))).toBe(false);
    });

    it('the row the API returns says it has no price, not that it costs 0', async () => {
        const { service } = subject({ current: [NULL_EXAMPLE] });
        expect((await service.getById('tenant_test', NULL_EXAMPLE.id)).price).toBeNull();
    });

    it('"Es gratis" on it writes the 0 and the confirmation together', async () => {
        const { service, executeInTenantSchema } = subject({ current: [NULL_EXAMPLE] });
        await service.update('tenant_test', NULL_EXAMPLE.id, { free: true }, 'tenant');
        const [, sql, params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('UPDATE services'))! as [string, string, any[]];
        expect(sql).toMatch(/price = \$1, price_status = \$2/);
        expect(params.slice(0, 2)).toEqual([0, 'confirmed']);
        expect(sql).not.toMatch(/\bfree\b/);
    });

    it('the editor resending 0 with "Precio confirmado" on a quote row is refused', async () => {
        const quoted = { ...EXAMPLE_ROW, price: '0', price_status: 'quote' };
        const { service, executeInTenantSchema } = subject({ current: [quoted] });
        await expect(service.update('tenant_test', quoted.id, { name: 'Visita de plomería', price: 0, priceStatus: 'confirmed' }, 'tenant'))
            .rejects.toMatchObject({ response: { error: 'price_missing' } });
        expect(executeInTenantSchema.mock.calls.some(([, sql]) => String(sql).startsWith('UPDATE services'))).toBe(false);
    });

    it('clearing a confirmed price is not a silent "no price"', async () => {
        const confirmed = { ...EXAMPLE_ROW, price_status: 'confirmed' };
        const { service } = subject({ current: [confirmed] });
        await expect(service.update('tenant_test', confirmed.id, { price: null }, 'tenant'))
            .rejects.toMatchObject({ response: { error: 'price_missing' } });
        await expect(service.update('tenant_test', confirmed.id, { price: '', priceStatus: 'confirmed' }, 'tenant'))
            .rejects.toMatchObject({ response: { error: 'price_missing' } });
    });

    it('an untouched seeded row without an amount saves the rest of the form as it is', async () => {
        const { service, executeInTenantSchema } = subject({ current: [NULL_EXAMPLE] });
        await service.update('tenant_test', NULL_EXAMPLE.id, { name: 'Consulta', price: null }, 'tenant');
        const [, sql, params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('UPDATE services'))! as [string, string, any[]];
        expect(sql).not.toContain('price_status');
        expect(params[1]).toBeNull();
    });

    it('a service created without a price (Assist) stores NULL, never a free 0', async () => {
        const { service, executeInTenantSchema } = subject({ current: [{ ...NULL_EXAMPLE, price_status: 'confirmed' }] });
        await service.create('tenant_test', { name: 'Limpieza facial', durationMinutes: 60 }, 'tenant');
        const [, sql, params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('INSERT INTO services'))! as [string, string, any[]];
        expect(sql).toContain('price, currency');
        expect(params[5]).toBeNull();
    });

    it('"Es gratis" when creating stores 0', async () => {
        const { service, executeInTenantSchema } = subject({ current: [{ ...EXAMPLE_ROW, price: '0', price_status: 'confirmed' }] });
        await service.create('tenant_test', { name: 'Asesoría inicial', durationMinutes: 30, priceStatus: 'confirmed', price: 0, free: true }, 'tenant');
        const [, , params] = executeInTenantSchema.mock.calls.find(([, s]) => String(s).startsWith('INSERT INTO services'))! as [string, string, any[]];
        expect(params[5]).toBe(0);
        expect(params[params.length - 1]).toBe('confirmed');
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
