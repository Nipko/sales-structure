import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * ═══ THE DRIVER THE TESTS USE IS NOT THE DRIVER PRODUCTION USES ═══
 *
 * Every `*.postgres.spec.ts` in this module drives the ledger through a raw
 * `pg` client. Production drives it through `PrismaService`. On one question
 * they disagree, and it is a question this codebase asks on every WhatsApp
 * admission:
 *
 *     WHERE created_at >= $4        -- with `input.since.toISOString()`
 *
 * `pg` leaves the parameter untyped and PostgreSQL infers `timestamptz`.
 * Prisma binds it as TEXT, and `timestamp with time zone >= text` has no
 * operator: `42883`.
 *
 * So six comparisons across two ledgers were green in every test and threw on
 * the first real call. The worst of them, `recentIdenticalDeliveries`, runs on
 * EVERY admission — every sink passes a `contentDigest` — so `authorize` would
 * rethrow, the processor would wrap it as `SpendMeterUnavailable`, and outbound
 * would defer every job: an outage produced entirely by a test harness that
 * could not see it. Another, `readRecentTurnOutcomes`, was SWALLOWED by its
 * store and returned `[]`, so the failure-notice `wait` simply never fired.
 *
 * These cases ask the question through the production primitive.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('time predicates under the production driver', () => {
    const schema = 'probe_time_predicates';
    let prisma: PrismaClient;
    jest.setTimeout(120_000);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        prisma = new PrismaClient({ datasourceUrl: databaseUrl });
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
        await prisma.$executeRawUnsafe(
            `CREATE TABLE ${schema}.t (id serial primary key, created_at timestamptz NOT NULL DEFAULT now())`);
        await prisma.$executeRawUnsafe(`INSERT INTO ${schema}.t DEFAULT VALUES`);
    });

    afterAll(async () => {
        if (!prisma) return;
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
        await prisma.$disconnect();
    });

    const since = () => new Date(Date.now() - 60_000).toISOString();

    it('REFUSES a bare string parameter — this is the trap, pinned', async () => {
        // Not a wish: the behaviour, so the rule below has a demonstrated
        // reason and nobody has to take it on faith.
        await expect(prisma.$queryRawUnsafe(
            `SELECT id FROM ${schema}.t WHERE created_at >= $1`, since()))
            .rejects.toThrow(/42883|operator does not exist/);
    });

    it('accepts the same string once the placeholder is cast', async () => {
        const rows = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id FROM ${schema}.t WHERE created_at >= $1::timestamptz`, since());
        expect(rows.length).toBe(1);
    });

    it('accepts a Date, which is the other way to be right', async () => {
        const rows = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id FROM ${schema}.t WHERE created_at >= $1`, new Date(Date.now() - 60_000));
        expect(rows.length).toBe(1);
    });
});

/**
 * And the sweep, so the next one is caught by a file rather than by an outage.
 *
 * A comparison is only safe when the placeholder is cast or the argument is a
 * `Date`. An ASSIGNMENT (`SET column = $1`) is fine either way — PostgreSQL
 * coerces text on the way in — which is exactly why this survived so long: the
 * writes worked and only the time-filtered reads did not.
 */
describe('no raw comparison binds a time column to an uncast string', () => {
    const SRC = resolve(__dirname, '..', '..', '..', 'modules');

    const sources = (): string[] => {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (!entry.endsWith('.ts') || entry.includes('.spec.')) continue;
                out.push(full);
            }
        };
        walk(SRC);
        return out;
    };

    it('finds none, and names any it finds', () => {
        const TIME_COLUMN = /_at|since|until|expires|starts|ends|scheduled/i;
        const offenders: string[] = [];

        for (const file of sources()) {
            const text = readFileSync(file, 'utf8');
            if (!text.includes('toISOString()')) continue;
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (!/toISOString\(\)/.test(lines[i])) continue;
                const window = lines.slice(Math.max(0, i - 30), i + 1).join('\n');
                for (const match of window.matchAll(/(\w+)\s*(>=|<=|>|<)\s*(\$\d+)(?!::)/g)) {
                    if (!TIME_COLUMN.test(match[1])) continue;
                    offenders.push(`${file.slice(SRC.length + 1).split('\\').join('/')}:${i + 1}`
                        + `  ${match[1]} ${match[2]} ${match[3]}`);
                }
            }
        }
        // Ordering comparisons only. `=` is excluded on purpose: an equality
        // against a time column is nearly always an assignment in an UPDATE,
        // and those are safe.
        expect(offenders).toEqual([]);
    });
});
