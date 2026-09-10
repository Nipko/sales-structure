/*
 * Run from the repository with:
 *   node docs/audits/2026-09-05/reproduce-onboarding.cjs
 *
 * Calls the dashboard's actual pure functions, transpiled in memory. The
 * selector sets model the initial render branches read during the audit;
 * this is not a browser/DOM integration test and does not contact an API.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repositoryRoot = path.resolve(__dirname, '../../..');

function loadTypeScript(relativePath, replacements = {}) {
  const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (id) => Object.prototype.hasOwnProperty.call(replacements, id)
      ? replacements[id]
      : require(id),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const contract = loadTypeScript('packages/shared/src/guided-tour-contract.ts');
const tours = loadTypeScript('apps/dashboard/src/lib/guided-tours.ts', {
  '@parallext/shared': contract,
});
const setup = loadTypeScript('apps/dashboard/src/lib/initial-setup.ts');

const tourCases = [
  {
    name: 'Appointments initial calendar tab',
    tourId: 'appointments_setup',
    route: '/admin/appointments',
    context: {},
    presentSelectors: ['#tour-target-appointments-tabs'],
    sourceEvidence: [
      'apps/dashboard/src/app/admin/appointments/page.tsx:142',
      'apps/dashboard/src/app/admin/appointments/page.tsx:965',
      'apps/dashboard/src/app/admin/appointments/page.tsx:981',
    ],
  },
  {
    name: 'Agent review launched without the default agent id',
    tourId: 'agent_handoff_rules',
    route: '/admin/agent',
    context: {},
    presentSelectors: [],
    sourceEvidence: [
      'apps/dashboard/src/components/InitialSetupCard.tsx:107',
      'apps/dashboard/src/lib/guided-tours.ts:58',
    ],
  },
  {
    name: 'Agent review with selected agent, initial persona tab',
    tourId: 'agent_handoff_rules',
    route: '/admin/agent/agent-id',
    context: { agentId: 'agent-id' },
    presentSelectors: [
      '#tour-target-agent-name',
      '#tour-target-agent-greeting',
      '#tour-target-agent-fallback',
      '#tour-target-agent-save',
    ],
    sourceEvidence: [
      'apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:134',
      'apps/dashboard/src/app/admin/agent/[agentId]/page.tsx:820',
    ],
  },
  {
    name: 'Human handoff tour with invitation dialog closed',
    tourId: 'human_handoff_route',
    route: '/admin/users',
    context: {},
    presentSelectors: [
      '#tour-users',
      '#tour-target-users-invite',
      '#tour-target-users-list',
    ],
    sourceEvidence: [
      'apps/dashboard/src/app/admin/users/page.tsx:192',
      'apps/dashboard/src/app/admin/users/page.tsx:729',
    ],
  },
];

const tourResults = tourCases.map((scenario) => {
  const plan = tours.planGuidedTourRun(scenario.tourId, scenario.context, {
    currentRoute: scenario.route,
    inPlace: false,
    isPresent: (selector) => scenario.presentSelectors.includes(selector),
  });
  const definitions = tours.getGuidedTourStepDefinitions(scenario.tourId, scenario.context);
  return {
    ...scenario,
    plan,
    retainedSteps: plan.stepIndexes.map((index) => definitions[index].key),
    omittedSteps: definitions
      .filter((_, index) => !plan.stepIndexes.includes(index))
      .map((step) => step.key),
  };
});

const checklistInput = {
  status: { hasKnowledge: true },
  planChannels: ['whatsapp'],
  activeChannels: ['whatsapp'],
  checks: {
    channel_connection: 'fail',
    channel_assignment: 'fail',
    knowledge_coverage: 'fail',
  },
};
const checklistItems = setup.buildEssentialSetupItems({
  ...checklistInput,
  canAccess: () => true,
}).filter((item) => ['channel', 'knowledge'].includes(item.key));

const evidence = {
  auditDate: '2026-09-05',
  verification: 'Actual pure functions; modeled initial-render selector sets; no browser or live tenant.',
  tourResults,
  checklist: {
    input: checklistInput,
    roleAccessAssumption: 'All tested dashboard routes allowed.',
    output: checklistItems,
    sourceEvidence: [
      'apps/dashboard/src/lib/initial-setup.ts:205',
      'apps/dashboard/src/lib/initial-setup.ts:244',
    ],
  },
};

const outputPath = path.join(__dirname, 'onboarding-reproduction.json');
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
