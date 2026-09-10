/** Transaction boundary for engine unit tests. Domain checkpoint SQL stays observable. */
export function runtimeStateTransactions(prisma: any): void {
    prisma.transactionInTenantSchema = async (schema: string, work: (query: any) => Promise<any>) => work(async (sql: string, params?: any[]) => {
        if (sql.includes('pg_advisory_xact_lock_shared')) return [];
        if (sql.startsWith('SELECT contact_id FROM conversations')) return [{ contact_id: 'contact' }];
        if (sql.includes("to_regclass('customer_memory_erasure')")) return [];
        return prisma.executeInTenantSchema(schema, sql, params);
    });
}
