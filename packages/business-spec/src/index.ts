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
export { resolveValue, isAffirmable, isTextWithoutData, extractFigures } from './status';
export type { ResolvedValue } from './status';
export { fromLegacyRows, normalizeHours, rowStatus } from './legacy-status';
export type { LegacyTenantRows } from './legacy-status';
export { emptySnapshot, SNAPSHOT_SCHEMA } from './snapshot';
export { evaluate, gapMessageFor } from './engine/evaluate';
export { CUSTOM_EVALUATORS, CUSTOM_EVALUATOR_IDS, GENERIC_EVALUATORS } from './engine/evaluators';
export { qaTruth, COMMON_NEVER } from './qa/truth';
export type { QaTruth, QaTruthCase, ExpectedCode } from './qa/truth';
export { renderReportMarkdown, renderTenantMarkdown, renderSummaryMarkdown } from './report';
export { generateRequirementsDoc } from './docs';
export { canonicalJson, sha256, hashOf } from './hash';
