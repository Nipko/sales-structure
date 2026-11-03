import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * D1m (E2i, C15, 3-nov-2026): «¿Tienen disponibilidad de Spark QA Tour para el sábado?» read check_package_availability →
 * «no_departure_on_date» and the reply stopped at the «no»; the 15-dic departure with 10 seats was never said. The next
 * departures now travel with the «no».
 */
const ID = '76775f40-2fdd-48e2-9db5-c6afa93573dc';
const executor = (inventory: unknown) => Object.assign(Object.create(AIToolExecutorService.prototype), {
    logger: { warn: jest.fn() },
    toursService: {
        checkAvailability: jest.fn().mockResolvedValue({ available: false, seatsLeft: 0, reason: 'no_departure_on_date' }),
        listInventory: typeof inventory === 'function' ? inventory : jest.fn().mockResolvedValue(inventory),
    },
}) as any;

describe('D1m: a date with no departure carries the next departures', () => {
    it('no departure on the date: the next ones (date, time, seats) and the instruction to give them', async () => {
        const r = await executor([{ departure_date: '2026-12-15', departure_time: '09:00', available_seats: 10 }])
            .checkPackageAvailabilityTool('tenant_viajes', ID, '2026-11-07', undefined);
        expect(r).toMatchObject({ available: false, reason: 'no_departure_on_date', nextDepartures: [{ date: '2026-12-15', time: '09:00', seatsLeft: 10 }] });
        expect(r.message).toMatch(/next departures/);
    });

    it('none scheduled: says so, with an empty list', async () => {
        const r = await executor([]).checkPackageAvailabilityTool('tenant_viajes', ID, '2026-11-07', undefined);
        expect(r.nextDepartures).toEqual([]);
        expect(r.message).toMatch(/no upcoming departure/);
    });

    it('the departures read fails: the plain «no departure» result, nothing claimed', async () => {
        const r = await executor(jest.fn().mockRejectedValue(new Error('db'))).checkPackageAvailabilityTool('tenant_viajes', ID, '2026-11-07', undefined);
        expect(r).toEqual({ available: false, seatsLeft: 0, reason: 'no_departure_on_date' });
    });

    it('any other result is returned as it was', async () => {
        const e = executor([]);
        e.toursService.checkAvailability.mockResolvedValue({ available: true, seatsLeft: 10 });
        expect(await e.checkPackageAvailabilityTool('tenant_viajes', ID, '2026-12-15', 2)).toEqual({ available: true, seatsLeft: 10 });
        expect(e.toursService.listInventory).not.toHaveBeenCalled();
    });
});
