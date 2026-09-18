import * as fs from "fs";
import * as path from "path";
import { GUIDED_TOUR_IDS, getGuidedTour, findGuidedTourForQualityCode, issueResolutionControl } from "@parallext/shared";
import {
  GUIDED_TOUR_ANCHOR_NAMES,
  getGuidedTourStepDefinitions,
  guidedTourAnchorId,
  guidedTourEntryRoute,
  guidedTourMessageKeys,
  guidedTourReviewedOnlyMessageKeys,
  guidedTourDependsOnReviewMode,
  parseGuidedTourResume,
  resolveGuidedTourReviewMode,
  resolveGuidedTourStepRoutes,
  planGuidedTourRun,
  buildGuidedTourSteps,
} from "./guided-tours";
import { resolveNavigationRoute } from "./navigation-contract";

/**
 * A guided tour that spotlights nothing is worse than no tour.
 *
 * "Mostrarme dónde" opens a screen and points at the control the person has to
 * touch. Every part of that promise can break silently: a renamed element
 * leaves the anchor dangling, a route that no longer exists sends the person to
 * a 404, missing copy renders the i18n key as the step title. None of it shows
 * up in `tsc`, and none of it shows up until a real tenant clicks the button
 * from a red banner — the worst possible moment to discover it.
 */

const SRC = path.join(__dirname, "..");
const AGENT_ID = "00000000-0000-4000-8000-000000000000";
const CONTEXT = { agentId: AGENT_ID };

function sourceFiles(directory = SRC): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

/** Anchor names actually rendered somewhere, from `guidedTourAnchorId("…")`. */
function renderedAnchorNames(): Set<string> {
  const pattern = /guidedTourAnchorId\(\s*["'`]([a-z0-9-]+)["'`]\s*\)/gi;
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

function readSpanishMessages(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(SRC, "..", "messages", "es.json"), "utf8"));
}

function lookup(messages: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, segment) => (node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined),
    messages,
  );
}

describe("guided tour catalogue", () => {
  it('reassigns a stale account without sending the owner to reconnect a healthy channel', () => {
    expect(findGuidedTourForQualityCode('fix_channel_connection', { staleBindings: 1, hasCredentialIssue: false })?.id).toBe('assign_agent_channel');
    expect(findGuidedTourForQualityCode('channel_connection', { staleBindings: 1, hasCredentialIssue: true })?.id).toBe('connect_channel');
    expect(findGuidedTourForQualityCode('channel_connection')?.id).toBe('connect_channel');
  });

  it('preserves required steps hidden in tabs and supplies a safe control to reveal them', () => {
    const plan = planGuidedTourRun('agent_handoff_rules', CONTEXT, {
      currentRoute: `/admin/agent/${AGENT_ID}`, inPlace: false,
      isPresent: selector => !selector.includes('rules') && !selector.includes('handoff'),
    });
    expect(plan.stepIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    const steps = getGuidedTourStepDefinitions('agent_handoff_rules', CONTEXT);
    expect(steps[3].prepareSelector).toBe('[data-tab-id="instructions"]');
    expect(steps[1].prepareSelector).toBe('[data-tab-id="persona"]');
  });

  it('turns an inactive agent on with the switch in immediate mode, the default', () => {
    // Audit #62: the tour for `agent_active` walked draft → candidate → review
    // → publication on screens the editor hides in immediate mode, while the
    // one switch that turns the agent on had no anchor.
    for (const context of [CONTEXT, { ...CONTEXT, reviewMode: 'immediate' as const }]) {
      const steps = getGuidedTourStepDefinitions('publish_agent_revision', context);
      expect(steps.map(step => step.key)).toEqual(['switch', 'channels']);
      expect(steps[0]).toMatchObject({ selector: '#tour-target-agent-active', route: `/admin/agent/${AGENT_ID}` });
      expect(resolveGuidedTourStepRoutes('publish_agent_revision', context))
        .toEqual([`/admin/agent/${AGENT_ID}`, `/admin/agent/${AGENT_ID}`]);
      // The step can tell when the agent is already on, from what a screen reader hears.
      expect(steps[0].completedWhen).toEqual({
        kind: 'present', selector: '#tour-target-agent-active [role="switch"][aria-checked="true"]',
      });
    }
    // And the resolution table names the same control for the same mode.
    expect(issueResolutionControl('agent_active', 'immediate')).toBe('agent_switch');
    expect(issueResolutionControl('agent_active', 'reviewed')).toBe('agent_publication');
    expect(GUIDED_TOUR_ANCHOR_NAMES).toContain('agent-active');
  });

  it('saves without the word draft in immediate mode and keeps the draft copy for reviewed mode', () => {
    for (const id of ['assign_agent_channel', 'agent_handoff_rules'] as const) {
      expect(getGuidedTourStepDefinitions(id, CONTEXT).at(-1)?.key).toBe('save');
      expect(getGuidedTourStepDefinitions(id, { ...CONTEXT, reviewMode: 'reviewed' }).at(-1)?.key).toBe('saveReviewed');
    }
    // Only keys a default-mode tenant can never render are left to reviewed-mode copy.
    const reviewedOnly = guidedTourReviewedOnlyMessageKeys();
    expect(reviewedOnly).toContain('guidedTours.publish_agent_revision.steps.draft.title');
    expect(reviewedOnly).toContain('guidedTours.agent_handoff_rules.steps.saveReviewed.content');
    expect(reviewedOnly.filter(key => guidedTourMessageKeys('immediate').includes(key))).toEqual([]);
    expect(guidedTourMessageKeys()).toEqual(expect.arrayContaining([
      ...guidedTourMessageKeys('immediate'), ...guidedTourMessageKeys('reviewed'),
    ]));
  });

  it('resumes a tour only with a change mode the product has', () => {
    const base = { tourId: 'publish_agent_revision', stepIndex: 0, route: '/admin/agent', scope: 'u:t', savedAt: 1_000 };
    const read = (context: Record<string, unknown>) => parseGuidedTourResume(JSON.stringify({ ...base, context }),
      { scope: 'u:t', route: '/admin/agent', role: 'tenant_admin', now: 2_000 });
    expect(read({ reviewMode: 'reviewed' })?.context.reviewMode).toBe('reviewed');
    expect(read({ reviewMode: null })).not.toBeNull();
    expect(read({ reviewMode: 'published' })).toBeNull();
  });

  it('knows which tours change with the mode, from their steps rather than a list', () => {
    const dependent = GUIDED_TOUR_IDS.filter(id => guidedTourDependsOnReviewMode(id, CONTEXT)).sort();
    expect(dependent).toEqual(['agent_handoff_rules', 'assign_agent_channel', 'publish_agent_revision']);
  });

  it('starts a run in the mode the launcher knew, or reads the tenant\'s only when the tour depends on it', async () => {
    // Audit: ProductTour built the context from agentId, channelType and
    // verticalCatalogRoute only, so a reviewed-mode tenant got the switch
    // tour and "al guardar… de inmediato". No launcher but the editor knows
    // the mode, so the runner reads it — and only when it matters.
    const read = jest.fn(async () => 'reviewed' as const);
    // The launcher's answer wins, and nothing is asked.
    expect(await resolveGuidedTourReviewMode('publish_agent_revision', CONTEXT, 'immediate', read)).toBe('immediate');
    expect(read).not.toHaveBeenCalled();
    // A tour that walks the same path in both modes starts without a request.
    expect(await resolveGuidedTourReviewMode('business_identity', {}, undefined, read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    // An agent tour with no mode from its launcher reads the tenant's.
    expect(await resolveGuidedTourReviewMode('publish_agent_revision', CONTEXT, undefined, read)).toBe('reviewed');
    expect(read).toHaveBeenCalledTimes(1);
    // A mode the product does not have is not trusted from either side.
    expect(await resolveGuidedTourReviewMode('assign_agent_channel', CONTEXT, 'published', async () => 'draft' as never)).toBeNull();
    // A failed read is the default mode's copy, as before — never a thrown tour.
    expect(await resolveGuidedTourReviewMode('agent_handoff_rules', CONTEXT, undefined, async () => { throw new Error('403'); })).toBeNull();
  });

  it('runs the home tour on what day 0 actually shows', () => {
    // Day 0 hides Home's help panel while the card has steps, and draws no
    // Assist launcher until the account is live (D7-A). Those two steps are
    // optional, so the plan leaves them out instead of stopping the run.
    const steps = getGuidedTourStepDefinitions('home_first_steps');
    expect(steps.filter(step => step.optional).map(step => step.key)).toEqual(['help', 'assistant']);
    const dayZero = planGuidedTourRun('home_first_steps', {}, {
      currentRoute: '/admin', inPlace: false,
      isPresent: selector => selector === '#tour-target-setup-card' || selector === '#tour-target-setup-next',
    });
    expect(dayZero.stepIndexes).toEqual([0, 1]);
    const live = planGuidedTourRun('home_first_steps', {}, { currentRoute: '/admin', inPlace: false, isPresent: () => true });
    expect(live.stepIndexes).toEqual([0, 1, 2, 3]);
    // The card and its next step stay required: without them there is no tour.
    const noCard = planGuidedTourRun('home_first_steps', {}, { currentRoute: '/admin', inPlace: false, isPresent: () => false });
    expect(noCard.stepIndexes).toEqual([0, 1]);
  });

  describe('resuming the setup starts on something Home really shows', () => {
    // F3: the tour opened on the card's "Continuar donde quedaste", which the
    // card draws only for a channel left for later. An owner who skipped the
    // wizard and then connected a channel had a card with steps left and got
    // "este recorrido no está disponible".
    const definitions = getGuidedTourStepDefinitions('resume_setup_wizard');
    /** Every step the plan keeps on the route it starts on has its anchor on screen. */
    const landsOnScreen = (present: readonly string[]) => {
      const isPresent = (selector: string) => present.includes(selector);
      const plan = planGuidedTourRun('resume_setup_wizard', {}, { currentRoute: '/admin', inPlace: false, isPresent });
      const routes = resolveGuidedTourStepRoutes('resume_setup_wizard');
      const home = plan.stepIndexes.filter(index => routes[index] === '/admin');
      return { plan, home, anchorsShown: home.every(index => isPresent(definitions[index].selector)) };
    };

    it('with a channel left for later: the next step, which holds "Continuar donde quedaste"', () => {
      const run = landsOnScreen(['#tour-target-setup-card', '#tour-target-setup-next']);
      expect(run.home).toEqual([0]);
      expect(run.anchorsShown).toBe(true);
    });

    it('without one — she skipped the wizard and connected a channel: the same next step', () => {
      // The card with steps left and no deferral: its next step is still drawn.
      const run = landsOnScreen(['#tour-target-setup-card', '#tour-target-setup-next']);
      expect(run.plan.stepIndexes[0]).toBe(0);
      expect(run.anchorsShown).toBe(true);
      expect(definitions[0]).toMatchObject({ key: 'entry', selector: '#tour-target-setup-next', route: '/admin' });
    });

    it('says what that step does in both cases, and promises only the reminder Home shows', () => {
      const messages = readSpanishMessages();
      const entry = lookup(messages, 'guidedTours.resume_setup_wizard.steps.entry.content') as string;
      // True with or without a deferral: no "el canal que dejaste para después"
      // over a next step that may be "Invita a tu equipo".
      expect(entry).toMatch(/Continuar/);
      expect(entry).not.toMatch(/canal que dejaste|asistente|acá/);
      const last = lookup(messages, 'guidedTours.resume_setup_wizard.steps.connect.content') as string;
      // Home no longer shows a way back into the wizard; it shows the card.
      expect(last).not.toMatch(/volver|asistente|acá/);
      expect(last).toContain('«Puesta en marcha»');
      expect(lookup(messages, 'qualityHealth.setup.title')).toBe('Puesta en marcha');
    });
  });

  it.each(['es', 'en', 'pt', 'fr'])('points at the next setup step without naming a channel or a time in %s', (locale) => {
    // F15: "Conectar WhatsApp toma unos 5 minutos" over a step that may be
    // Instagram, or not a channel at all.
    const messages = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'messages', `${locale}.json`), 'utf8'));
    const next = lookup(messages, 'guidedTours.home_first_steps.steps.next.content') as string;
    expect(next).not.toMatch(/WhatsApp|Instagram|Messenger|Telegram|\d|minut/i);
    expect(next.trim().length).toBeGreaterThan(0);
  });

  it('walks an inactive agent through draft, test, review, and publication in reviewed mode', () => {
    const steps = getGuidedTourStepDefinitions('publish_agent_revision', { ...CONTEXT, reviewMode: 'reviewed' });
    expect(steps.map(step => step.key)).toEqual(['draft', 'test', 'prepare', 'review', 'publish']);
    expect(steps.map(step => step.route ?? null)).toEqual([
      `/admin/agent/${AGENT_ID}`,
      `/admin/agent/${AGENT_ID}/test`,
      `/admin/agent/${AGENT_ID}/releases`,
      null,
      `/admin/agent/${AGENT_ID}/publications`,
    ]);
    expect(getGuidedTour('publish_agent_revision')?.qualityCodes).toContain('agent_active');
  });

  it('does not navigate away after opening a FAQ or invitation editor', () => {
    const faq = getGuidedTourStepDefinitions('knowledge_base');
    expect(faq.slice(faq.findIndex(step => step.key === 'fields')).every(step => !step.route)).toBe(true);
    const users = getGuidedTourStepDefinitions('human_handoff_route');
    expect(users[users.length - 1]).toMatchObject({ key: 'role', prepareSelector: '#tour-target-users-invite' });
  });

  it.each(['instagram', 'messenger', 'telegram', 'web_chat'])('keeps %s channel guidance free of WhatsApp steps', (channelType) => {
    const steps = getGuidedTourStepDefinitions('connect_channel', { channelType });
    expect(steps.some(step => step.selector.includes('whatsapp') || step.route?.includes('whatsapp'))).toBe(false);
    expect(steps.at(-1)?.key).toBe('channel');
  });

  it('keeps protected in-place tours free of all route navigation metadata', () => {
    const plan = planGuidedTourRun('knowledge_base', {}, { currentRoute: '/admin/knowledge', inPlace: true, isPresent: () => true });
    const steps = buildGuidedTourSteps('knowledge_base', {}, key => key, plan);
    expect(steps.every(step => !step.nextRoute && !step.prevRoute && !(step as any).tourRoute)).toBe(true);
  });
  it("gives every registered tour at least two steps", () => {
    const tooShort = GUIDED_TOUR_IDS
      .map((id) => ({ id, steps: getGuidedTourStepDefinitions(id, CONTEXT).length }))
      .filter((entry) => entry.steps < 2);
    expect(tooShort).toEqual([]);
  });

  it("starts every tour on a tour anchor, never on an arbitrary element", () => {
    for (const id of GUIDED_TOUR_IDS) {
      const [first] = getGuidedTourStepDefinitions(id, CONTEXT);
      expect(`${id}:${first.selector}`).toMatch(/:#tour-/);
    }
  });

  it("only ever navigates to routes the navigation contract knows", () => {
    const unknown: string[] = [];
    for (const id of GUIDED_TOUR_IDS) {
      for (const route of resolveGuidedTourStepRoutes(id, CONTEXT)) {
        if (!resolveNavigationRoute(route)) unknown.push(`${id} → ${route}`);
      }
      // The entry route is what the runner pushes before step 0.
      if (!resolveNavigationRoute(guidedTourEntryRoute(id, CONTEXT))) {
        unknown.push(`${id} → entry ${guidedTourEntryRoute(id, CONTEXT)}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("keeps the agent-scoped tours on the registry route when no agent is focused", () => {
    for (const id of GUIDED_TOUR_IDS) {
      const withoutAgent = guidedTourEntryRoute(id, {});
      expect(resolveNavigationRoute(withoutAgent)).not.toBeNull();
      const tour = getGuidedTour(id);
      if (tour?.stayOnCurrentRoute) expect(withoutAgent.startsWith("/admin")).toBe(true);
    }
  });

  it("points every anchor at an element that some screen actually renders", () => {
    const rendered = renderedAnchorNames();
    const missing = GUIDED_TOUR_ANCHOR_NAMES.filter((name) => !rendered.has(name));
    // The message names the anchors AND the id to add, so the fix is mechanical.
    expect({
      missing,
      hint: missing.map((name) => `id={guidedTourAnchorId("${name}")} → ${guidedTourAnchorId(name)}`),
    }).toEqual({ missing: [], hint: [] });
  });
});

describe("guided tour copy", () => {
  const messages = readSpanishMessages();

  it("has the guidedTours namespace at all", () => {
    // This used to gate the check below, so the whole parity assertion skipped
    // itself while the merge was pending — and would have gone on skipping
    // silently if the namespace were ever dropped. The pending state is over;
    // its absence is now a failure, not a reason to stop looking.
    expect(Object.keys(messages.guidedTours ?? {}).length).toBeGreaterThan(0);
  });

  it.each(['es', 'en', 'pt', 'fr'])("has all tour and verification copy in %s", locale => {
    const localized = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'messages', `${locale}.json`), 'utf8'));
    const keys = [...guidedTourMessageKeys(), 'guidedTours.connect_channel.steps.channel.title', 'guidedTours.connect_channel.steps.channel.content',
      'qualityHealth.setup.items.appointments', 'qualityHealth.setup.verificationUnavailable', 'qualityHealth.focus.verificationUnavailable',
      'qualityHealth.focus.verifiedResolved', 'productTour.finishFormFirst'];
    keys.push(...['ready', 'verify', 'unsupported', 'assign', 'coverage', 'reassign', 'credentials', 'connect'].map(key => `qualityHealth.setup.channelActions.${key}`),
      ...['title', 'draftScope', 'unsupported', 'disconnected', 'stale', 'remove'].map(key => `agent.assignmentReview.${key}`),
      'qualityHealth.setup.pendingReason', 'agentQuality.banner.verificationTitle', 'agentQuality.banner.verificationPending',
      'agentQuality.evidenceKeys.unsupportedChannelTypes', 'qualityHealth.focus.explanations.stale_channel_binding',
      'qualityHealth.focus.explanations.fix_operational_channel_scope');
    expect(keys.filter(key => typeof lookup(localized, key) !== 'string')).toEqual([]);
  });
});
