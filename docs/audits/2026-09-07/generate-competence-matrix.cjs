/* Code-backed coverage only. No database, model, provider or tenant changes. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/api/tsconfig.json');
require(path.join(root, 'node_modules/ts-node')).register({ transpileOnly: true });
require(path.join(root, 'node_modules/tsconfig-paths')).register({ baseUrl: root,
  paths: { '@parallext/shared': ['packages/shared/src/index.ts'] } });
const { buildTaskCompetenceMatrix } = require(path.join(root, 'apps/api/src/modules/simulation/task-competence-matrix.ts'));
const matrix = { sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  ...buildTaskCompetenceMatrix() };
if (process.argv.includes('--json')) fs.writeFileSync(path.join(__dirname, 'competence-matrix.json'), JSON.stringify(matrix, null, 2) + '\n');
const csv = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
const rows = [['profile', 'task', 'commits', 'required_configuration', 'required_slots', 'tools', 'effect_verifiers', 'states', 'confirmation', 'channels', 'languages', 'gaps', 'execution_evidence']];
for (const profile of matrix.profiles) for (const task of profile.tasks) rows.push([
  profile.profileId, task.key, task.commits, profile.requiredConfiguration.join(' | '),
  task.requiredSlots.map(slot => `${slot.key}:${slot.type}:${slot.source}`).join(' | '),
  task.tools.map(tool => tool.name).join(' | '),
  [...new Set(task.tools.flatMap(tool => tool.effectVerifier ? [`${tool.effectVerifier.family}:${tool.effectVerifier.table}.${tool.effectVerifier.ownershipColumn}`] : []))].join(' | '),
  task.states.join(' > '), task.confirmation, task.channelEvidence.map(row => row.channel).join(' | '),
  task.scenarios.map(row => row.language).join(' | '), task.gaps.join(' | '), 'not_run',
]);
fs.writeFileSync(path.join(__dirname, 'competence-matrix.csv'), '\uFEFF' + rows.map(row => row.map(csv).join(',')).join('\n') + '\n');
const summary = matrix.summary;
const markdown = [
  '# Cobertura de competencia por perfil', '',
  'Registro generado desde contratos de dominio, herramientas, dependencias y escenarios del código. No contiene datos de clientes.', '',
  `Perfiles canónicos: **${summary.profiles}**. Tareas declaradas: **${summary.tasks}**. Tareas que comprometen al negocio: **${summary.committingTasks}**.`, '',
  `Tareas sin caso positivo con efecto verificable: **${summary.tasksMissingPositiveCases}**. Tareas con alguna herramienta de escritura sin verificador de efecto: **${summary.tasksMissingVerifiers}**.`, '',
  'La matriz describe cobertura declarada. Los estados por canal e idioma permanecen en «no ejecutado» hasta asociar evidencia de una revisión concreta. No hereda certificación de otro perfil ni convierte un escenario genérico llamado «camino feliz» en prueba de una operación terminada.', '',
  'La disponibilidad comercial, el permiso de ejecutar una herramienta y la existencia de un verificador de lectura son dimensiones distintas. La prueba de carga de módulos o de componentes tampoco certifica un proveedor externo.', '',
  `Revisión base del repositorio: \`${matrix.sourceRevision}\`; incluye los cambios del árbol de trabajo al generar.`, '',
  '[Detalle de tareas en CSV](competence-matrix.csv). El contrato completo está disponible en `GET /eval/:tenantId/competence-matrix`; el generador también lo exporta con `--json`.', '',
  '| Perfil | Tareas | Comprometen al negocio | Sin caso positivo | Herramientas no registradas |',
  '|---|---:|---:|---:|---|',
  ...matrix.profiles.map(profile => `| ${profile.profileId} | ${profile.tasks.length} | ${profile.tasks.filter(task => task.commits).length} | ${profile.tasks.filter(task => task.gaps.includes('positive_task_case_missing')).length} | ${[...new Set(profile.tasks.flatMap(task => task.tools.filter(tool => !tool.registered).map(tool => tool.name)))].join(', ') || '—'} |`), '',
  'Para actualizar: ejecutar `node docs/audits/2026-09-07/generate-competence-matrix.cjs` desde la raíz. Cada cierre requiere escenario, datos de prueba, comando canónico, verificador, revisión del agente y evidencia por canal e idioma.', '',
];
fs.writeFileSync(path.join(__dirname, 'competence-matrix.md'), markdown.join('\n'));
process.stdout.write(JSON.stringify(summary) + '\n');
