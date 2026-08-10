import { collectApiPages, pagedQueryString, readApiPage } from '../pagination';

describe('mobile paginated selectors', () => {
    it('loads records beyond the first 200 items', async () => {
        const records = Array.from({ length: 205 }, (_, index) => ({ id: String(index + 1) }));
        const fetchPage = jest.fn(async (limit: number, offset: number) => ({
            success: true,
            data: {
                items: records.slice(offset, offset + limit),
                total: records.length,
                limit,
                offset,
                hasMore: offset + limit < records.length,
            },
        }));

        const result = await collectApiPages<{ id: string }>(fetchPage, 100);
        expect(result).toHaveLength(205);
        expect(result[204].id).toBe('205');
        expect(fetchPage.mock.calls.map(([, offset]) => offset)).toEqual([0, 100, 200]);
    });

    it('propagates selector API errors instead of presenting an empty result', () => {
        expect(() => readApiPage({ success: false, error: 'database unavailable' }))
            .toThrow('database unavailable');
    });

    it('encodes server-side search and incremental offsets', () => {
        expect(pagedQueryString({ search: 'Ana Pérez', limit: 40, offset: 80 }))
            .toBe('search=Ana+P%C3%A9rez&limit=40&offset=80');
    });
});
