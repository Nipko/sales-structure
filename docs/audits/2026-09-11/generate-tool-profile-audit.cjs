/* Read-only census; --write updates only this audit's JSON/Markdown artifacts. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
require(path.join(root, 'node_modules/ts-node')).register({
  project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true,
});
require(path.join(root, 'node_modules/tsconfig-paths')).register({
  baseUrl: root, paths: { '@parallext/shared': ['packages/shared/src/index.ts'] },
});
const ts = require(path.join(root, 'node_modules/typescript'));
const shared = require(path.join(root, 'packages/shared/src/index.ts'));
const base = 'apps/api/src/modules/conversations/';
const registry = require(path.join(root, base, 'agent-tool-registry.ts'));
const policy = require(path.join(root, base, 'tool-policy-registry.ts'));
const navigation = require(path.join(root, 'apps/dashboard/src/lib/vertical-dashboard-resolver.ts'));
const navigationContract = require(path.join(root, 'apps/dashboard/src/lib/navigation-contract.ts'));
const { buildTaskCompetenceMatrix } = require(path.join(root, 'apps/api/src/modules/simulation/task-competence-matrix.ts'));
const definitions = new Map();
for (const file of fs.readdirSync(path.join(root, base, 'tools')).filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts')).sort()) {
  for (const value of Object.values(require(path.join(root, base, 'tools', file)))) {
    for (const tool of Array.isArray(value) ? value : [value]) {
      if (tool && typeof tool.name === 'string' && tool.parameters) {
        const sources = definitions.get(tool.name) || new Set();
        sources.add(`${base}tools/${file}`);
        definitions.set(tool.name, sources);
      }
    }
  }
}
const executorPath = `${base}ai-tool-executor.service.ts`;
const executor = ts.createSourceFile(executorPath, fs.readFileSync(path.join(root, executorPath), 'utf8'), ts.ScriptTarget.Latest, true);
const branches = new Set();
function visit(node) {
  if (ts.isSwitchStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === 'toolName') {
    for (const clause of node.caseBlock.clauses) {
      if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) branches.add(clause.expression.text);
    }
  }
  ts.forEachChild(node, visit);
}
visit(executor);
const matrix = buildTaskCompetenceMatrix();
const runtimeConfigurationControls = new Set([
  ...shared.AGENT_CONFIG_TOOL_FAMILIES.map(family => `tools.${family}.enabled`),
  ...registry.TOOL_SUBPERMISSION_RULES.map(rule => `tools.${String(rule.family)}.${rule.flag}`),
  'tools.ecommerce.canApplyDiscount', 'tools.payments.canCreateLinks',
  ...shared.AGENT_EMAIL_CONFIRMATION_FAMILIES.map(family => `tools.${family}.emailConfirmations`),
]);
const assistConfigurationControls = new Set(shared.AGENT_CONFIGURATION_PATHS
  .filter(item => item.startsWith('tools.')));
const byProfile = new Map(matrix.profiles.map(profile => [profile.profileId, profile]));
const tools = [...new Set([...policy.STATIC_TOOL_NAMES, ...definitions.keys(), ...branches])].sort().map(name => ({
  name, definitionSources: [...(definitions.get(name) || [])], executorBranch: branches.has(name),
  policy: policy.getToolPolicy(name) || null,
  families: registry.TOOL_FAMILIES.filter(family => family.tools.some(tool => tool.name === name)).map(family => family.key),
  asynchronous: policy.ASYNC_GATED_TOOL_NAMES.has(name),
  declaredTasks: matrix.profiles.flatMap(profile => profile.tasks
    .filter(task => task.tools.some(tool => tool.name === name))
    .map(task => `${profile.profileId}:${task.key}`)),
}));
const profiles = shared.listCanonicalSubtypeExperienceProfileIds().sort().map(id => {
  const [industry, subtype] = id.split('/');
  const manifest = shared.resolveVerticalCapabilityManifest(industry, subtype === '__none__' ? null : subtype);
  const experience = shared.resolveSubtypeExperienceProfile(industry, subtype);
  const nav = navigation.resolveVerticalDashboard({ industry, subType: manifest.subtype,
    manifestVersion: manifest.manifestVersion, effectiveCapabilities: manifest.capabilities });
  const rows = manifest.routes.map(route => {
    const item = navigation.getVerticalDashboardItemForPath(route);
    const pageExists = fs.existsSync(path.join(root, 'apps/dashboard/src/app', route, 'page.tsx'));
    return { route, item, navigationId: navigationContract.resolveNavigationRoute(route)?.definition.id ?? null,
      pageExists, visible: navigation.isVerticalDashboardPathVisible(nav, route) };
  });
  const tasks = byProfile.get(id)?.tasks || [];
  return { id, industry, subtype, strategy: experience.strategy,
    availability: shared.subtypeAvailability(experience), primaryObject: manifest.primaryObject,
    capabilities: manifest.capabilities, toolGroups: manifest.toolGroups,
    readiness: manifest.readiness.requirements, routes: rows,
    toolsByGroup: manifest.toolGroups.map(group => ({ group,
      tools: registry.TOOL_FAMILIES.find(family => family.key === group)?.tools.map(tool => tool.name) || [],
      readiness: shared.TOOL_GROUP_READINESS[group] || null,
      planFeature: shared.TOOL_GROUP_PLAN_FEATURE[group] || null })),
    tasks: tasks.map(task => ({ key: task.key, commits: task.commits,
      tools: task.tools.map(tool => tool.name), gaps: task.gaps })),
    executionEvidence: 'not_loaded',
  };
});
const result = { version: 1, evidenceKind: 'structural_only', sourceHashEncoding: 'utf8-lf',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  summary: { verticals: shared.VERTICAL_MANIFEST_INDUSTRIES.length, profiles: profiles.length,
    staticTools: tools.length, nativeFamilies: registry.TOOL_FAMILIES.length,
    configurationFamilies: shared.AGENT_CONFIG_TOOL_FAMILIES.length,
    toolsByOrigin: Object.fromEntries(['core', 'vertical', 'provider'].map(origin => [origin, tools.filter(tool => tool.policy?.origin === origin).length])),
    tasks: matrix.summary.tasks, committingTasks: matrix.summary.committingTasks,
    toolsWithoutDefinition: tools.filter(tool => !tool.definitionSources.length).map(tool => tool.name),
    toolsWithoutExecutorBranch: tools.filter(tool => !tool.executorBranch).map(tool => tool.name),
    toolsWithoutPolicy: tools.filter(tool => !tool.policy).map(tool => tool.name),
    missingDeclaredControls: policy.getMissingToolControls(),
    assistantUnreachableControls: [...runtimeConfigurationControls]
      .filter(control => !assistConfigurationControls.has(control)).sort(),
    assistantUnbackedControls: [...assistConfigurationControls]
      .filter(control => !runtimeConfigurationControls.has(control)).sort(),
    hiddenDeclaredRoutes: profiles.flatMap(profile => profile.routes.filter(route => route.visible === false).map(route => `${profile.id}:${route.route}`)),
    unmappedDeclaredRoutes: profiles.flatMap(profile => profile.routes.filter(route => route.navigationId === null).map(route => `${profile.id}:${route.route}`)),
    missingPages: profiles.flatMap(profile => profile.routes.filter(route => !route.pageExists).map(route => `${profile.id}:${route.route}`)),
    taskCoverage: matrix.summary,
  },
  // Hash each repository source loaded by this command, plus the parsed executor.
  // This includes transitive profile/domain/eval sources, not just hand-picked inputs.
  sources: {}, profiles, tools,
};
const inputs = [...new Set([...Object.keys(require.cache)
  .filter(file => file.startsWith(root + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`)), path.join(root, executorPath)])].sort();
// Git may check out CRLF on Windows and LF in CI. Hash canonical source text;
// newline conversion alone is not a changed tool/profile contract.
const canonicalText = file => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
for (const [relative, file] of inputs.map(file => [path.relative(root, file).replaceAll('\\', '/'), file])
  .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)) {
  result.sources[relative] = crypto.createHash('sha256').update(canonicalText(file)).digest('hex');
}
const jsonPath = path.join(__dirname, 'tool-profile-audit.json');
const mdPath = path.join(__dirname, 'tool-profile-audit.md');
const render = data => [
  '# Matriz estructural de herramientas por tipo de negocio', '',
  `Origen: \`${data.sourceRevision}\`. Fuentes y hashes completos en [JSON](./tool-profile-audit.json).`, '',
  `${data.summary.verticals} verticales; ${data.summary.profiles} tipos de negocio; ${data.summary.staticTools} herramientas estáticas; ${data.summary.nativeFamilies} familias nativas; ${data.summary.tasks} tareas (${data.summary.committingTasks} transaccionales).`, '',
  'Este censo comprueba correspondencias de código. No ejecuta herramientas ni modelos, no consulta tenants y no certifica resultados comerciales. MCP dinámico no pertenece al censo estático. La ausencia de evidencia cargada no prueba que una cuenta nunca se haya probado.', '',
  `Rutas declaradas ocultas: ${data.summary.hiddenDeclaredRoutes.length}. Páginas inexistentes: ${data.summary.missingPages.length}. Herramientas sin definición/handler/política: ${data.summary.toolsWithoutDefinition.length}/${data.summary.toolsWithoutExecutorBranch.length}/${data.summary.toolsWithoutPolicy.length}. Controles del runtime fuera de Assist/sin respaldo: ${data.summary.assistantUnreachableControls.length}/${data.summary.assistantUnbackedControls.length}.`, '',
  '| Vertical / tipo de negocio | Objeto principal | Familias | Tareas | Estrategia |',
  '|---|---|---|---:|---|',
  ...data.profiles.map(profile => `| ${profile.id} | ${profile.primaryObject} | ${profile.toolGroups.join(', ')} | ${profile.tasks.length} | ${profile.strategy} |`), '',
  'El JSON enumera cada herramienta, sus fuentes, política, handler, familias y tareas; cada perfil enumera sus rutas, readiness y herramientas. Los permisos de rol/plan/proveedor/datos deben verificarse en los tests y en el recorrido completo: este documento no los deduce de una ruta visible.', '',
].join('\n');
if (process.argv.includes('--write')) {
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(mdPath, render(result));
} else if (process.argv.includes('--check')) {
  const previous = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  // A docs-only commit may move HEAD without changing any authority.
  const current = { ...result, sourceRevision: previous.sourceRevision };
  if (JSON.stringify(previous) !== JSON.stringify(current) || canonicalText(mdPath) !== render(previous)) {
    throw new Error('tool_profile_audit_stale: run with --write');
  }
  const failures = ['toolsWithoutDefinition', 'toolsWithoutExecutorBranch', 'toolsWithoutPolicy',
    'missingDeclaredControls', 'assistantUnreachableControls', 'assistantUnbackedControls',
    'hiddenDeclaredRoutes', 'unmappedDeclaredRoutes', 'missingPages']
    .filter(key => result.summary[key].length > 0);
  if (failures.length) throw new Error(`tool_profile_contract_failed: ${failures.join(', ')}`);
}
process.stdout.write(JSON.stringify(result.summary, null, 2) + '\n');
