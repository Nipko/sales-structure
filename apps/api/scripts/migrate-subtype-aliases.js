/**
 * Reescribe los subtipos guardados que ya no son el id canónico.
 *
 * ═══ CANONIZAR AL LEER NO ALCANZA ═══
 *
 * El resolutor aplica el alias en cada lectura, así que el runtime se comporta
 * bien. Lo que no se arregla solo es todo lo que mira el valor **guardado**:
 *
 * - El panel muestra el subtipo del tenant. Un dueño que fue clasificado como
 *   "peluquería canina" bajo Veterinaria ve eso, y su selector ya no ofrece esa
 *   opción: no puede cambiarla ni entender por qué figura.
 * - Cualquier consulta que agrupe por `verticalConfig.subType` —analítica por
 *   vertical, reportes, la matriz de contratos— cuenta un rubro que el registro
 *   no tiene.
 * - Y cada consumidor nuevo tiene que acordarse de canonizar. El que se olvide
 *   vuelve a partir la identidad en dos.
 *
 * Los tres modos, en el orden en que esto se hace sin romper nada:
 *
 *   --dry-run   Cuenta y ubica. No escribe. Es lo primero.
 *   --apply     Reescribe `verticalConfig.industry`/`subType` al id canónico,
 *               sin tocar el resto de `settings`. Idempotente.
 *   --verify    Confirma que no queda ninguno. Falla si queda.
 *
 * Uso:
 *   docker exec parallext-api node scripts/migrate-subtype-aliases.js --dry-run
 *   docker exec parallext-api node scripts/migrate-subtype-aliases.js --apply
 *   docker exec parallext-api node scripts/migrate-subtype-aliases.js --verify
 */

const { PrismaClient } = require('@prisma/client');
const { SUBTYPE_ALIASES } = require('@parallext/shared');

const prisma = new PrismaClient();
const MODES = ['--dry-run', '--apply', '--verify'];
const mode = MODES.find((m) => process.argv.includes(m));

function aliasFor(industry, subtype) {
    if (!industry || !subtype) return null;
    return SUBTYPE_ALIASES[`${String(industry).trim()}/${String(subtype).trim()}`] || null;
}

async function scan() {
    const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, industry: true, settings: true },
    });
    const rows = [];
    for (const tenant of tenants) {
        const config = (tenant.settings || {}).verticalConfig;
        if (!config) continue;
        const industry = config.industry || tenant.industry;
        const target = aliasFor(industry, config.subType);
        if (!target) continue;
        const [canonIndustry, canonSubtype] = target.split('/');
        rows.push({
            tenant,
            from: `${industry}/${config.subType}`,
            industry: canonIndustry,
            subtype: canonSubtype,
        });
    }
    return { total: tenants.length, rows };
}

async function main() {
    if (!mode) {
        console.error(`Falta el modo. Uno de: ${MODES.join(' | ')}`);
        process.exitCode = 2;
        return;
    }

    const { total, rows } = await scan();
    console.log(`[migrate-subtype-aliases] ${mode}`);
    console.log(`Tenants revisados: ${total}`);
    console.log(`Con subtipo no canónico: ${rows.length}\n`);
    for (const row of rows) {
        console.log(`  ${row.tenant.id}  ${row.tenant.name}: ${row.from} → ${row.industry}/${row.subtype}`);
    }

    if (mode === '--dry-run') {
        console.log(rows.length
            ? '\nNada se escribió. Corré con --apply cuando quieras migrarlos.'
            : '\nNo queda ninguno.');
        return;
    }

    if (mode === '--verify') {
        if (rows.length) {
            console.error(`\nQuedan ${rows.length} tenants con un subtipo que el registro no tiene.`);
            process.exitCode = 1;
        } else {
            console.log('\nTodos los subtipos guardados son canónicos.');
        }
        return;
    }

    // --apply
    let applied = 0;
    let failed = 0;
    for (const row of rows) {
        try {
            // Un `jsonb_set` por tenant, sobre la fila viva: reescribir
            // `settings` entero desde esta foto pisaría lo que otro proceso
            // haya guardado mientras el script corre — y corre sobre
            // producción, con el sistema andando.
            await prisma.$executeRawUnsafe(
                `UPDATE public.tenants
                    SET settings = jsonb_set(
                        jsonb_set(
                            settings,
                            '{verticalConfig,industry}', to_jsonb($2::text), true
                        ),
                        '{verticalConfig,subType}', to_jsonb($3::text), true
                    ),
                    industry = $2,
                    updated_at = NOW()
                  WHERE id = $1::uuid
                    AND settings #>> '{verticalConfig,subType}' = $4`,
                row.tenant.id, row.industry, row.subtype, row.from.split('/')[1],
            );
            applied += 1;
        } catch (error) {
            failed += 1;
            console.error(`  ! ${row.tenant.id}: ${error.message}`);
        }
    }
    console.log(`\nMigrados: ${applied}. Con error: ${failed}.`);
    if (failed) process.exitCode = 1;
}

module.exports = { aliasFor };

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
