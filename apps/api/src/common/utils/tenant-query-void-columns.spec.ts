import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

/**
 * `transactionInTenantSchema`/`executeInTenantSchema` ejecutan cada sentencia con
 * `$queryRawUnsafe`, que SIEMPRE intenta deserializar un result set. Una sentencia
 * que devuelve `void` (`pg_advisory_xact_lock`) o que no devuelve filas (`SET LOCAL`)
 * revienta con:
 *
 *   Failed to deserialize column of type 'void'
 *
 * Pasó en producción (ago 2026): la migración de propiedad de evidencia nativa falló
 * en los 10 schemas y no aplicó nada, en silencio, porque el lock era la primera
 * sentencia de la transacción. El arreglo es castear a un tipo serializable
 * (`::text`) y usar `set_config(...)` en vez de `SET LOCAL`.
 *
 * Este contrato es estático a propósito: no hay Postgres en el gate rápido, y el
 * modo de falla solo aparece en runtime contra la base real.
 */
describe('tenant query primitive: no void columns', () => {
    const apiSrc = resolve(__dirname, '../..');

    const sourceFiles = (): string[] => {
        const listed = execSync('git ls-files "*.ts"', { cwd: apiSrc, encoding: 'utf8' });
        return listed
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.endsWith('.spec.ts'));
    };

    it('never selects a bare pg_advisory_xact_lock as the whole statement', () => {
        // Un lock dentro de un CTE (`WITH ... AS MATERIALIZED (SELECT pg_advisory...)`)
        // es válido: la columna void se queda adentro y nunca llega al cliente. Lo que
        // rompe es la sentencia suelta, que termina justo después del lock.
        const offenders: string[] = [];
        for (const file of sourceFiles()) {
            const content = readFileSync(resolve(apiSrc, file), 'utf8');
            const bareLock = /SELECT pg_advisory_xact_lock\([^`]*?\)\s*`/g;
            let match: RegExpExecArray | null;
            while ((match = bareLock.exec(content)) !== null) {
                if (!match[0].includes('::text')) {
                    offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ').trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('never runs SET LOCAL through the tenant query primitive', () => {
        // `SET` no devuelve result set. El equivalente funcional que sí devuelve texto
        // es `set_config(name, value, is_local => true)`.
        const offenders: string[] = [];
        for (const file of sourceFiles()) {
            const content = readFileSync(resolve(apiSrc, file), 'utf8');
            if (/query\(\s*`SET LOCAL/.test(content)) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });
});
