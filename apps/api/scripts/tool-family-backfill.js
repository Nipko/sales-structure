'use strict';

/**
 * Additive tool-family backfill for EXISTING tenants, run by the deploy's
 * tenant migration (`scripts/migrate-tenants.js`) after each tenant's schema
 * template has been applied.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * PR #77 made the signup of `automotriz/alquiler` enable the `vehicleRentals`
 * family and the signup of `pet_services/guarderia` / `hotel` enable
 * `petBoarding`, because the capability manifest has always declared them. The
 * tenants that signed up BEFORE that PR have the subtype, the menu entry and
 * the `/admin/resource-rentals` screen, but their agents carry no such family,
 * so the agent sees the object in the product and has nothing to book it with:
 * every rental or stay ends in a hand-off. New signups were fixed; these were
 * not.
 *
 * ═══ HOW AN OWNER'S «OFF» IS TOLD APART FROM «NEVER SET» ═══
 *
 * An agent stores its families in `agent_personas.config_json.tools.<family>`.
 * The family editor writes `{ enabled: false }` when the owner turns a family
 * off (`{ ...(tools[key] ?? { enabled: false }), enabled: value }`), and so do
 * Assist proposals (`tools.<family>.enabled`). A family nobody ever touched has
 * NO key at all: the two families below are in no template. So:
 *
 *   · key absent / null                     -> never set: enable it;
 *   · object with no `enabled` at all        -> never decided (for instance
 *                                              `{ emailConfirmations: true }`):
 *                                              enable it, keep the other fields;
 *   · `enabled === true`                    -> already on: nothing to do;
 *   · `enabled === false`, any other `enabled` value, or a non-object value ->
 *                                              the owner's decision (or something
 *                                              we cannot read): LEFT EXACTLY AS IT IS.
 *
 * This is the same rule `VerticalsService.enableSimpleTool` applies to a new
 * signup, so a backfilled agent is indistinguishable from a born one.
 *
 * ═══ WHAT IT WILL NEVER DO ═══
 *
 *   · disable or remove anything (it only ever writes `enabled: true`);
 *   · touch a family outside `BACKFILLABLE_FAMILIES`, or a tenant whose subtype
 *     is not in `TOOL_FAMILY_BACKFILL_PROFILES`;
 *   · touch an inactive tenant or an inactive agent;
 *   · fail the deploy: every error is caught, logged and counted, the tenant's
 *     transaction rolls back, and the next deploy tries again.
 *
 * ═══ WHY IT IS SAFE TO RUN ON EVERY DEPLOY ═══
 *
 * A tenant whose agents already have the family produces an empty plan and no
 * write (no `UPDATE`, no `version` bump), so a second run is a no-op. It is
 * also what makes re-running NECESSARY: a tenant that signs up on the old
 * containers during a failed deploy, or an agent created later from a template,
 * is picked up by the next deploy.
 *
 * ═══ WHY A TABLE AND NOT THE WHOLE MANIFEST ═══
 *
 * The profiles below are the ones PR #77 fixed for new signups. Enabling every
 * family the manifest lists for every subtype would also switch on tools no
 * owner was ever offered (catalog, gyms, insurance...) on production tenants in
 * one deploy; widening this table is a product decision, one reviewed line at a
 * time. `tool-family-backfill.spec.ts` keeps the table honest against the
 * manifest: every family here must be one the manifest gives that subtype, and
 * no subtype may carry a backfillable family in the manifest without a row.
 */

const SCHEMA_PATTERN = /^tenant_[a-z0-9_]{1,56}$/;

/** Families this backfill is allowed to turn on. */
const BACKFILLABLE_FAMILIES = Object.freeze(['vehicleRentals', 'petBoarding']);

const TOOL_FAMILY_BACKFILL_PROFILES = Object.freeze([
  Object.freeze({ industry: 'automotriz', subType: 'alquiler', families: Object.freeze(['vehicleRentals']) }),
  Object.freeze({ industry: 'pet_services', subType: 'guarderia', families: Object.freeze(['petBoarding']) }),
  Object.freeze({ industry: 'pet_services', subType: 'hotel', families: Object.freeze(['petBoarding']) }),
]);

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const normalize = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** Families the tenant's subtype is owed, or [] when it is not a backfilled profile. */
function familiesForProfile(industry, subType) {
  const wantedIndustry = normalize(industry);
  const wantedSubType = normalize(subType);
  if (!wantedIndustry || !wantedSubType) return [];
  const profile = TOOL_FAMILY_BACKFILL_PROFILES.find(
    (candidate) => candidate.industry === wantedIndustry && candidate.subType === wantedSubType,
  );
  return profile ? [...profile.families] : [];
}

/**
 * Same precedence the platform uses to read a tenant's vertical
 * (`VerticalsService`): the published `verticalConfig`, then the legacy
 * `settings.subType` / `tenants.industry`.
 */
function tenantVerticalIdentity(tenant) {
  const industry = tenant.vc_industry || tenant.industry;
  const subType = tenant.vc_sub_type || tenant.legacy_sub_type;
  return { industry: normalize(industry), subType: normalize(subType) };
}

/**
 * Pure. Decides, for one agent's `config_json`, which families to turn on.
 * Never mutates its input. `changed` is false when there is nothing to write.
 */
function planAgentToolBackfill(configJson, families) {
  const config = isPlainObject(configJson) ? configJson : {};
  const hasTools = config.tools !== undefined && config.tools !== null;
  // A `tools` value that is not an object is not something we can extend
  // without discarding it: leave the agent alone and say so.
  if (hasTools && !isPlainObject(config.tools)) {
    return { changed: false, config: configJson, enabled: [], alreadyOn: [], preserved: [...families], unreadable: true };
  }
  const tools = isPlainObject(config.tools) ? config.tools : {};
  const nextTools = { ...tools };
  const enabled = [];
  const alreadyOn = [];
  const preserved = [];
  for (const family of families) {
    if (!BACKFILLABLE_FAMILIES.includes(family)) continue;
    const current = tools[family];
    if (current === undefined || current === null) {
      nextTools[family] = { enabled: true };
      enabled.push(family);
    } else if (isPlainObject(current)) {
      if (current.enabled === undefined) {
        nextTools[family] = { ...current, enabled: true };
        enabled.push(family);
      } else if (current.enabled === true) alreadyOn.push(family);
      else preserved.push(family); // false, or a value we cannot read: not ours to change
    } else {
      preserved.push(family);
    }
  }
  if (enabled.length === 0) {
    return { changed: false, config: configJson, enabled, alreadyOn, preserved, unreadable: false };
  }
  return {
    changed: true,
    config: { ...config, tools: nextTools },
    enabled,
    alreadyOn,
    preserved,
    unreadable: false,
  };
}

function emptyTotals() {
  return {
    tenantsConsidered: 0,
    tenantsChanged: 0,
    agentsChanged: 0,
    familiesEnabled: 0,
    familiesAlreadyOn: 0,
    familiesPreservedOff: 0,
    errors: 0,
  };
}

/**
 * Backfills ONE tenant inside its own transaction. Resolves a result object and
 * never throws: `{ status: 'not_applicable' | 'skipped_inactive' | 'ok' | 'error', ... }`.
 */
async function backfillTenantToolFamilies({ prisma, tenant, dryRun = false, log = console.log, logError = console.error }) {
  const identity = tenantVerticalIdentity(tenant);
  const families = familiesForProfile(identity.industry, identity.subType);
  if (families.length === 0) return { status: 'not_applicable' };
  if (tenant.is_active !== true) return { status: 'skipped_inactive' };
  if (!SCHEMA_PATTERN.test(String(tenant.schema_name))) {
    logError(`  [BACKFILL-SKIP] Unsafe tenant schema identifier: ${tenant.schema_name}`);
    return { status: 'error', error: 'unsafe_schema' };
  }
  const schema = tenant.schema_name;
  const label = `${identity.industry}/${identity.subType}`;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // A row lock that queues behind live traffic fails fast and the tenant is
      // retried by the next deploy, instead of stalling the migration.
      await tx.$queryRawUnsafe("SELECT set_config('lock_timeout', $1, true)", '5000ms');
      const agents = await tx.$queryRawUnsafe(
        `SELECT id, config_json FROM "${schema}"."agent_personas" WHERE is_active = true ORDER BY id FOR UPDATE`,
      );
      const outcome = { agentsChanged: 0, enabled: 0, alreadyOn: 0, preserved: 0, details: [] };
      for (const agent of agents || []) {
        const plan = planAgentToolBackfill(agent.config_json, families);
        outcome.alreadyOn += plan.alreadyOn.length;
        outcome.preserved += plan.preserved.length;
        if (!plan.changed) continue;
        if (!dryRun) {
          await tx.$executeRawUnsafe(
            `UPDATE "${schema}"."agent_personas"
                SET config_json = $1::jsonb,
                    version = COALESCE(version, 0) + 1,
                    updated_at = NOW()
              WHERE id = $2::uuid`,
            JSON.stringify(plan.config),
            agent.id,
          );
        }
        outcome.agentsChanged++;
        outcome.enabled += plan.enabled.length;
        outcome.details.push({ agentId: agent.id, enabled: plan.enabled });
      }
      return outcome;
    }, { maxWait: 10000, timeout: 60000 });
    for (const detail of result.details) {
      log(
        `  [BACKFILL] ${schema} ${label} agent=${detail.agentId}: `
        + `${dryRun ? 'would enable' : 'enabled'} ${detail.enabled.join(',')}`,
      );
    }
    return { status: 'ok', ...result };
  } catch (error) {
    const message = String((error && error.message) || error).replace(/\s+/g, ' ').trim().substring(0, 200);
    logError(`  [BACKFILL-WARN] ${schema} ${label}: tool-family backfill rolled back (${message}); the next deploy retries`);
    return { status: 'error', error: message };
  }
}

/**
 * Builds the per-tenant hook the migration calls plus its running totals.
 * `run(tenant)` never throws and never touches the migration's own counters.
 */
function createToolFamilyBackfill({ prisma, dryRun = false, enabled = true, log = console.log, logError = console.error }) {
  const totals = emptyTotals();
  return {
    totals,
    async run(tenant) {
      if (!enabled) return { status: 'disabled' };
      const identity = tenantVerticalIdentity(tenant);
      if (familiesForProfile(identity.industry, identity.subType).length === 0) return { status: 'not_applicable' };
      const result = await backfillTenantToolFamilies({ prisma, tenant, dryRun, log, logError });
      if (result.status === 'not_applicable' || result.status === 'skipped_inactive') return result;
      totals.tenantsConsidered++;
      if (result.status === 'error') {
        totals.errors++;
        return result;
      }
      totals.familiesAlreadyOn += result.alreadyOn;
      totals.familiesPreservedOff += result.preserved;
      if (result.agentsChanged > 0) {
        totals.tenantsChanged++;
        totals.agentsChanged += result.agentsChanged;
        totals.familiesEnabled += result.enabled;
      }
      return result;
    },
    summaryLine() {
      return `TOOL_FAMILY_BACKFILL_SUMMARY${enabled ? '' : ' disabled=true'}${dryRun ? ' dry_run=true' : ''}`
        + ` tenants=${totals.tenantsConsidered} tenants_changed=${totals.tenantsChanged}`
        + ` agents_changed=${totals.agentsChanged} families_enabled=${totals.familiesEnabled}`
        + ` already_on=${totals.familiesAlreadyOn} preserved_off=${totals.familiesPreservedOff}`
        + ` errors=${totals.errors}`;
    },
  };
}

/** `TOOL_FAMILY_BACKFILL=off` disables it; `TOOL_FAMILY_BACKFILL_DRY_RUN=true` logs without writing. */
function readBackfillOptions(env = process.env) {
  return {
    enabled: String(env.TOOL_FAMILY_BACKFILL || '').toLowerCase() !== 'off',
    dryRun: String(env.TOOL_FAMILY_BACKFILL_DRY_RUN || '').toLowerCase() === 'true',
  };
}

module.exports = {
  BACKFILLABLE_FAMILIES,
  TOOL_FAMILY_BACKFILL_PROFILES,
  familiesForProfile,
  tenantVerticalIdentity,
  planAgentToolBackfill,
  backfillTenantToolFamilies,
  createToolFamilyBackfill,
  readBackfillOptions,
};
