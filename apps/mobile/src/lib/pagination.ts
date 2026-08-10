export interface PagedQuery {
    search?: string;
    limit?: number;
    offset?: number;
    status?: string;
    species?: string;
}

export interface ApiPage<T> {
    items: T[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

export function pagedQueryString(query: PagedQuery = {}): string {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        params.set(key, String(value));
    });
    return params.toString();
}

export function readApiPage<T>(response: any, requestedOffset = 0): ApiPage<T> {
    if (!response?.success) throw new Error(response?.error || 'load_failed');

    const payload = response.data;
    const items = Array.isArray(payload)
        ? payload as T[]
        : Array.isArray(payload?.items)
            ? payload.items as T[]
            : [];
    const total = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : items.length;
    const limit = Number.isFinite(Number(payload?.limit)) ? Number(payload.limit) : items.length;
    const offset = Number.isFinite(Number(payload?.offset)) ? Number(payload.offset) : requestedOffset;
    const hasMore = typeof payload?.hasMore === 'boolean'
        ? payload.hasMore
        : offset + items.length < total;

    return { items, total, limit, offset, hasMore };
}

export async function collectApiPages<T>(
    fetchPage: (limit: number, offset: number) => Promise<any>,
    pageSize = 100,
): Promise<T[]> {
    const collected: T[] = [];
    let offset = 0;

    while (true) {
        const page = readApiPage<T>(await fetchPage(pageSize, offset), offset);
        collected.push(...page.items);
        if (!page.hasMore || page.items.length === 0) return collected;
        offset += page.items.length;
    }
}
