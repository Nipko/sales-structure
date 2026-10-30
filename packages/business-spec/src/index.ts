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
    realRowProvenance, applyRequirementValues, valueRecordFromRow, valueFingerprint, migratedRef, projectedRef,
} from './provenance';
export type { ProvenanceOrigin, ProvenanceTable, RowProvenance, MigratedSourceRef, ProjectedSourceRef } from './provenance';
export {
    RUNTIME_FACT_IDS, POLICY_REQUIREMENTS, projectedStorageOf, factRows, factSnapshot, ownerFact, hoursToRuntime, i18nText,
    resolveBusinessHours, renderPolicyText, resolvePolicy, resolveNotOffered, resolveIdentity, applyLegacyPatch, projectToLegacy,
    projectionInSync,
} from './business-facts';
export type {
    FactSources, OwnerFact, RuntimeDay, RuntimeBusinessHours, RuntimePolicy, NotOfferedEntry, IdentityOverlay, LegacyPatch, LegacyProjection,
} from './business-facts';
export { validateRequirementValue, requiredFieldsOutsideDictionary, isValueRequirement, isIsoDuration, unionOptions, MAX_VALUE_BYTES } from './validate-value';
export type { ValueIssue, ValueWriteInput } from './validate-value';
export { planProvenanceBackfill, applyBackfillPlan } from './backfill';
export type { BackfillPlan, PlannedValue, PlannedRow, SkippedValue } from './backfill';
export { emptySnapshot, SNAPSHOT_SCHEMA } from './snapshot';
export { evaluate, gapMessageFor } from './engine/evaluate';
export { CUSTOM_EVALUATORS, CUSTOM_EVALUATOR_IDS, GENERIC_EVALUATORS } from './engine/evaluators';
export { qaTruth, requirementsForIntent, itemFieldState, COMMON_NEVER } from './qa/truth';
export type { QaTruth, QaTruthCase, QaTruthQuery, ExpectedCode } from './qa/truth';
export { buildTurnContract, renderKnowledgeStatus, compactValue, TURN_CONTRACT_SCHEMA } from './contract/turn';
export type {
    TurnKnowledgeContract, TurnContractFact, TurnContractUnknown, TurnContractOptions, KnowledgeState, ObjectWriteMode, RenderKnowledgeStatusOptions,
} from './contract/turn';
export { renderReportMarkdown, renderTenantMarkdown, renderSummaryMarkdown } from './report';
export { generateRequirementsDoc } from './docs';
export { canonicalJson, sha256, hashOf } from './hash';
export { formFor, formRequirementIds, screenTargetsFor, hasOwnerForm, parseField, splitTop, FORM_SCHEMA, DURATION_UNITS, WEEK_DAYS } from './forms/descriptor';
export type { FormDescriptor, FormField, FormFieldKind, FormOption, FormCondition, FormMode } from './forms/descriptor';
export {
    generateRehearsal, servedLanguages, seededRandom, REHEARSAL_SCHEMA, REHEARSAL_MAX_CASES, REHEARSAL_LANGUAGES,
} from './rehearsal/generate';
export type {
    RehearsalBank, RehearsalCase, RehearsalCoverage, RehearsalEvent, RehearsalExpectation, RehearsalOptions, RehearsalSkip,
} from './rehearsal/generate';
export { gradeCase, needsJudge, summarize, isPass, passHatK, PENDING_TOOL } from './rehearsal/grade';
export type {
    RehearsalObservation, RehearsalToolCall, RehearsalOutcome, RehearsalCheck, RehearsalCheckId, RehearsalGrade, RehearsalSummary, JudgeVerdict,
} from './rehearsal/grade';
export { figuresOfText, figuresOfValue, figureLabel, hasMoneyFigure } from './rehearsal/figures';
export {
    checkCopilotProposal, normalizeQuoteText, quoteAppearsIn, valueFigures, figuresWithoutQuote, isCopilotRequirement, sameCopilotValue,
    genericTextReason, MIN_QUOTE_CHARS, MAX_QUOTE_CHARS, MAX_EVIDENCE,
} from './copilot';
export type { CopilotEvidence, CopilotSource, CopilotCheck, CopilotRejection, CopilotRejectionCode } from './copilot';
