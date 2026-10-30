/**
 * @parallext/business-spec — núcleo puro (sin E/S). La lectura de YAML está en `src/load.ts`.
 * Diseño: C0 §1 y §3; formato: docs/domain/business-requirements-format.md.
 */
export * from './types';
export { compile, compileOrThrow, checkExternal, parseObjectRef } from './compile';
export type { SpecDocs, SpecError, SpecErrorCode, CompileOptions } from './compile';
export { parseExpr, evalExpr, exprToString, ATOMS } from './expr';
export type { Expr, ExprEnv } from './expr';
export { compose, composeFor } from './compose';
export type { EffectiveRequirement } from './compose';
export { resolveFacts, RESERVABLE_OBJECTS } from './facts';
export type { TenantFacts } from './facts';
export { resolveValue, isAffirmable, isTextWithoutData, extractFigures, isInheritedRecord, isInheritedItem } from './status';
export type { ResolvedValue } from './status';
export {
    fromLegacyRows, normalizeHours, rowStatus, hoursFromAgenda, inferCovers, FAQ_COVERS_RULES, legacyRowProvenance, rowProvenance, legacyContextOf,
} from './legacy-status';
export type { LegacyTenantRows, LegacyContext } from './legacy-status';
export {
    PROVENANCE_ORIGINS, MIGRATION_ORIGINS, PROVENANCE_TABLES, BACKFILL_MARK, PRICE_TYPES, STORED_STATUSES,
    realRowProvenance, applyRequirementValues, valueRecordFromRow, valueFingerprint, migratedRef,
} from './provenance';
export type { ProvenanceOrigin, ProvenanceTable, RowProvenance, MigratedSourceRef } from './provenance';
export { validateRequirementValue, isValueRequirement, MAX_VALUE_BYTES } from './validate-value';
export type { ValueIssue, ValueWriteInput } from './validate-value';
export { planProvenanceBackfill, applyBackfillPlan } from './backfill';
export type { BackfillPlan, PlannedValue, PlannedRow, SkippedValue } from './backfill';
export { emptySnapshot, SNAPSHOT_SCHEMA } from './snapshot';
export { evaluate, gapMessageFor } from './engine/evaluate';
export { CUSTOM_EVALUATORS, CUSTOM_EVALUATOR_IDS, GENERIC_EVALUATORS } from './engine/evaluators';
export { qaTruth, requirementsForIntent, itemFieldState, COMMON_NEVER } from './qa/truth';
export type { QaTruth, QaTruthCase, QaTruthQuery, ExpectedCode } from './qa/truth';
export { renderReportMarkdown, renderTenantMarkdown, renderSummaryMarkdown } from './report';
export { generateRequirementsDoc } from './docs';
export { canonicalJson, sha256, hashOf } from './hash';
export { formFor, formRequirementIds, hasOwnerForm, parseField, splitTop, FORM_SCHEMA, DURATION_UNITS, WEEK_DAYS } from './forms/descriptor';
export type { FormDescriptor, FormField, FormFieldKind, FormOption, FormCondition, FormMode } from './forms/descriptor';
