/**
 * The real size of a customer-records list read with a LIMIT: the query carries `COUNT(*) OVER() AS total_count` (counted before
 * the LIMIT), so «Usted tiene 3 pedidos» is never read off a cut list. Rows without the column (or no rows) add nothing.
 */
export function listTotal(rows: any[]): { total?: number; hasMore?: boolean } {
    const total = Number(rows?.[0]?.total_count);
    if (!rows?.length || !Number.isInteger(total) || total < rows.length) return {};
    return { total, hasMore: total > rows.length };
}
