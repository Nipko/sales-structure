import { BadRequestException } from '@nestjs/common';
import { LlmMeasurementService, measurementKey } from './llm-measurement.service';

function prismaStub(rows: any[] = []) {
    const calls: Array<{ sql: string; values: any[] }> = [];
    const $queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join('?').replace(/\s+/g, ' ').trim();
        calls.push({ sql, values });
        if (sql.startsWith('INSERT INTO')) return [{ id: 'm1', model_id: values[0], bench: values[1], n: values[2], pass: values[3], pass_rate: String(values[4]) }];
        return rows;
    });
    return { prisma: { $queryRaw } as any, calls };
}

describe('LlmMeasurementService', () => {
    it('registra con la tasa calculada (no la que manda quien llama) y recorta textos', async () => {
        const { prisma, calls } = prismaStub();
        const svc = new LlmMeasurementService(prisma);
        await svc.record({ modelId: ' gpt-6-luna ', bench: 'signed_confirmation', n: 28, pass: 27, runRef: 'out/confirmbench.json', notes: '  ', measuredAt: '2026-11-09T11:00:00Z' }, 'u1');
        const insert = calls[0];
        expect(insert.values.slice(0, 5)).toEqual(['gpt-6-luna', 'signed_confirmation', 28, 27, 0.9643]);
        expect(insert.values[9]).toBeNull(); // notes vacías
        expect(insert.values[10]).toBe('u1');
        expect(insert.values[11]).toEqual(new Date('2026-11-09T11:00:00Z'));
    });

    it.each([
        [{ modelId: 'bad id', bench: 'rehearsal_7t', n: 1, pass: 1 }, 'measurement_bad_model_id'],
        [{ modelId: 'm', bench: 'vibes', n: 1, pass: 1 }, 'measurement_bad_bench:vibes'],
        [{ modelId: 'm', bench: 'rehearsal_7t', n: 0, pass: 0 }, 'measurement_bad_n'],
        [{ modelId: 'm', bench: 'rehearsal_7t', n: 10, pass: 11 }, 'measurement_bad_pass'],
        [{ modelId: 'm', bench: 'rehearsal_7t', n: 10, pass: 5, measuredAt: '2099-01-01T00:00:00Z' }, 'measurement_in_future'],
        [{ modelId: 'm', bench: 'rehearsal_7t', n: 10, pass: 5, catalogVersion: -1 }, 'measurement_bad_catalog_version'],
    ])('rechaza %o', async (input, message) => {
        const svc = new LlmMeasurementService(prismaStub().prisma);
        await expect(svc.record(input as any)).rejects.toThrow(new BadRequestException(message));
    });

    it('latest indexa la última por (modelo, banco) y no consulta sin modelos', async () => {
        const { prisma, calls } = prismaStub([
            { model_id: 'a', bench: 'rehearsal_7t', n: 270, pass: 254, pass_rate: '0.9407', measured_at: new Date('2026-11-09'), catalog_version: 1 },
        ]);
        const svc = new LlmMeasurementService(prisma);
        expect((await svc.latest([])).size).toBe(0);
        expect(calls).toHaveLength(0);
        const latest = await svc.latest(['a', 'a', 'b']);
        expect(calls[0].values[0]).toEqual(['a', 'b']);
        expect(latest.get(measurementKey('a', 'rehearsal_7t'))).toEqual({
            modelId: 'a', bench: 'rehearsal_7t', n: 270, pass: 254, passRate: 0.9407, measuredAt: new Date('2026-11-09'), catalogVersion: 1,
        });
    });
});
