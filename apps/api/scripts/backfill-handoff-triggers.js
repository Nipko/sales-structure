// scripts/backfill-handoff-triggers.js
//
// Quita de los agentes YA SEMBRADOS las palabras de handoff que ahora bloquean
// el intake de su propia vertical.
//
// Por qué hace falta: `patchDefaultAgent` UNE los handoffTriggers del registry
// con los de la plantilla y escribe el resultado en `agent_personas.config_json`.
// Arreglar el registry corrige a los tenants NUEVOS; los que ya existen
// conservan la lista vieja en su fila. Este es el paso 3 del diseño
// capturar-y-escalar del plan consolidado — el que, según el propio plan, "se
// olvida siempre".
//
// Qué NO hace: no toca palabras que deban escalar sin intake (fraude, disputa,
// electrocución, peligro), ni triggers que el dueño haya escrito a mano y no
// estén en la lista de retiro.
//
// Uso:
//   node scripts/backfill-handoff-triggers.js           # dry-run: solo reporta
//   node scripts/backfill-handoff-triggers.js --apply   # escribe

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

// Palabras a retirar por industria. Son exactamente las que una tool de intake
// captura mejor que un humano en frío, y cuya escalada ahora ocurre DESPUÉS del
// intake vía el flag shouldHandoff.
const RETIRAR = {
    servicios_hogar: ['emergencia', 'fuga de gas', 'inundación', 'inundacion', 'cortocircuito',
        'emergency', 'gas leak', 'flood', 'short circuit',
        'emergência', 'vazamento de gás', 'inundação',
        'urgence', 'fuite de gaz', 'inondation'],
    seguros: ['reclamo', 'siniestro', 'claim', 'incident', 'sinistre'],
    pet_services: ['enfermedad', 'illness'],
    automotriz: ['prueba de manejo', 'test drive', 'essai routier'],
};

const norm = (s) => String(s || '').trim().toLowerCase();

async function main() {
    console.log(`--- Backfill de handoffTriggers (${APPLY ? 'APPLY' : 'DRY-RUN'}) ---`);

    const tenants = await prisma.$queryRaw`
        SELECT id, schema_name, industry, settings FROM tenants WHERE is_active = true
    `;

    let tocados = 0, revisados = 0;

    for (const t of tenants) {
        // La industria efectiva vive en settings.verticalConfig (el seeder la
        // escribe ahí); tenants.industry es el respaldo.
        const settings = t.settings || {};
        const industry = settings?.verticalConfig?.industry || t.industry;
        const retirar = RETIRAR[industry];
        if (!retirar) continue;

        const retirarSet = new Set(retirar.map(norm));

        let agents;
        try {
            agents = await prisma.$queryRawUnsafe(
                `SELECT id, name, config_json FROM "${t.schema_name}".agent_personas WHERE is_active = true`,
            );
        } catch (e) {
            console.log(`  [SKIP] ${t.schema_name}: ${String(e.message).slice(0, 80)}`);
            continue;
        }

        for (const a of agents) {
            revisados++;
            const cfg = a.config_json || {};
            const behavior = cfg.behavior || {};
            const actuales = Array.isArray(behavior.handoffTriggers) ? behavior.handoffTriggers : [];
            if (actuales.length === 0) continue;

            const quedan = actuales.filter((x) => !retirarSet.has(norm(x)));
            if (quedan.length === actuales.length) continue;

            const quitados = actuales.filter((x) => retirarSet.has(norm(x)));
            console.log(`  ${t.schema_name} / ${a.name}: -[${quitados.join(', ')}]  (quedan ${quedan.length})`);
            tocados++;

            if (APPLY) {
                const nuevo = { ...cfg, behavior: { ...behavior, handoffTriggers: quedan } };
                await prisma.$executeRawUnsafe(
                    `UPDATE "${t.schema_name}".agent_personas
                     SET config_json = $1::jsonb, updated_at = NOW()
                     WHERE id = $2::uuid`,
                    JSON.stringify(nuevo), a.id,
                );
            }
        }
    }

    console.log(`--- ${tocados} agente(s) ${APPLY ? 'actualizados' : 'a actualizar'} de ${revisados} revisados ---`);
    if (!APPLY && tocados > 0) console.log('    Correr de nuevo con --apply para escribir.');
    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error('ERROR:', e.message);
    await prisma.$disconnect();
    process.exit(1);
});
