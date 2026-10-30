import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * La cola de conocimiento pendiente (R5, ADR 0011) nace en dos sitios: `tenant-schema.sql` (tenant nuevo) y la
 * migración que crea las tablas en los tenants que ya existen. Si divergen, un tenant viejo y uno nuevo deduplican o
 * avisan distinto. Esta prueba exige la misma definición, el índice único parcial del diseño (C0 §2.6), que la
 * migración sea aditiva y que `kb_unanswered_queries` no se borre (tiene datos: su DROP es una tarea del dueño).
 */
const PRISMA = resolve(__dirname, '../../../prisma');
const MIGRATION_DIR = readdirSync(resolve(PRISMA, 'migrations')).find(d => d.endsWith('_add_pending_questions'));

const tableBody = (sql: string, table: string) => {
    const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS [^\\n]*"${table}" \\(([\\s\\S]*?)\\n\\s*\\)`));
    if (!m) throw new Error(`sin CREATE TABLE ${table}`);
    return m[1].split('\n').map(l => l.trim().replace(/,$/, '')
        // la referencia al esquema se escribe distinto en cada sitio
        .replace(/REFERENCES \S+\."pending_questions"/, 'REFERENCES "pending_questions"')).filter(Boolean);
};
const indexes = (sql: string) => [...sql.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON [^\n]*"(pending_\w+)" \(([^)]*)\)( WHERE [^\n;]*)?/g)]
    .map(m => [m[1] ?? '', m[2], m[3], m[4], (m[5] ?? '').trim()]);

describe('pending_questions: tenant nuevo = tenant migrado', () => {
    const template = readFileSync(resolve(PRISMA, 'tenant-schema.sql'), 'utf8');
    const migration = readFileSync(resolve(PRISMA, 'migrations', String(MIGRATION_DIR), 'migration.sql'), 'utf8');
    const code = migration.replace(/--.*$/gm, '');

    it('la migración existe, es aditiva y no toca kb_unanswered_queries', () => {
        expect(MIGRATION_DIR).toBeDefined();
        expect(code.replace(/ON DELETE CASCADE/g, '')).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE|RENAME|ALTER)\b/i);
        expect(code).not.toContain('kb_unanswered_queries');
        expect(template).toContain('"kb_unanswered_queries"');
    });

    it('las dos definiciones coinciden columna por columna y en los índices', () => {
        for (const table of ['pending_questions', 'pending_question_waiters']) {
            expect(tableBody(migration, table)).toEqual(tableBody(template, table));
        }
        expect(indexes(migration)).toEqual(indexes(template));
    });

    it('una sola fila abierta por tema (índice único parcial de C0 §2.6) y una espera por conversación', () => {
        expect(indexes(template)).toContainEqual(['UNIQUE ', 'uq_pending_questions_open_topic', 'pending_questions', 'topic_key', "WHERE status IN ('gap','open')"]);
        expect(tableBody(template, 'pending_question_waiters')).toContain('CONSTRAINT pending_question_waiters_once UNIQUE (pending_question_id, conversation_id)');
        expect(tableBody(template, 'pending_questions').join('\n')).toContain("CHECK (status IN ('gap','open','answered','stored','closed','dismissed'))");
    });

    it('el ON CONFLICT del servicio usa exactamente el predicado del índice', () => {
        const topic = readFileSync(resolve(__dirname, 'pending-question-topic.ts'), 'utf8');
        expect(topic).toContain(`ON CONFLICT (topic_key) WHERE status IN ('gap','open')`);
    });
});
