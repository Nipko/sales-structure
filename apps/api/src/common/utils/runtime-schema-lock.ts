import type { Prisma, PrismaClient } from '@prisma/client';

/** Classify the leading statement, never DDL words inside values or comments. */
export function isRuntimeSchemaDdl(sql: string): boolean {
    let offset = 0;
    while (offset < sql.length) {
        if (/\s/.test(sql[offset])) { offset += 1; continue; }
        if (sql.startsWith('--', offset)) {
            const end = sql.indexOf('\n', offset);
            offset = end < 0 ? sql.length : end + 1;
            continue;
        }
        if (!sql.startsWith('/*', offset)) break;
        let depth = 1;
        offset += 2;
        while (depth && offset < sql.length) {
            if (sql.startsWith('/*', offset)) { depth += 1; offset += 2; }
            else if (sql.startsWith('*/', offset)) { depth -= 1; offset += 2; }
            else offset += 1;
        }
    }
    const statement = sql.slice(offset);
    return /^(?:CREATE\s+(?:(?:OR\s+REPLACE|UNIQUE|TEMP(?:ORARY)?|UNLOGGED)\s+)*(?:TABLE|INDEX|SCHEMA|TYPE|SEQUENCE|FUNCTION|TRIGGER|EXTENSION)\b|ALTER\s+(?:TABLE|TYPE|INDEX|SCHEMA)\b|DO\s+\$)/i.test(statement);
}

export async function acquireRuntimeSchemaLock(
    tx: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>,
    schema: string,
): Promise<void> {
    await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text',
        `runtime-schema:${schema}`,
    );
}

/** Shared by every runtime initializer touching a schema, including different services. */
export async function withRuntimeSchemaLock<T>(
    prisma: PrismaClient,
    schema: string,
    initialize: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
    return prisma.$transaction(async (tx) => {
        await acquireRuntimeSchemaLock(tx, schema);
        return initialize(tx);
    }, { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 30_000 });
}
