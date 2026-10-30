/**
 * Aceptación R1 #1: la validación de CI falla en cada defecto de C0 §3, con un test por regla.
 * Cada test parte de la especificación real (que compila sin defectos) y le inyecta un solo defecto.
 */
import { checkExternal, compile, type SpecDocs, type SpecErrorCode } from '../src/compile';
import { generateRequirementsDoc } from '../src/docs';
import { readSpecDocs } from '../src/load';
import { runCheck } from '../bin/cli';

const pristine = readSpecDocs();
const clone = (): SpecDocs => ({ ...JSON.parse(JSON.stringify({ ...pristine, schema: undefined })), schema: pristine.schema });
const codes = (docs: SpecDocs, options?: Parameters<typeof compile>[1]): SpecErrorCode[] => compile(docs, options).errors.map(e => e.code);
const core = (d: SpecDocs, id: string) => d.core.requirements.find((r: any) => r.id === id);
const profile = (d: SpecDocs, id: string) => d.profiles.profiles.find((p: any) => p.profile === id);

describe('compile: la especificación del repo', () => {
    it('compila sin defectos: 95 requisitos, 169 instancias', () => {
        const { spec, errors } = compile(pristine);
        expect(errors).toEqual([]);
        expect(spec.order).toHaveLength(169);
        expect(new Set(spec.order.map(id => spec.requirements[id].templateId ?? id)).size).toBe(95);
        expect(spec.specVersion).toBe('1.1.0-rc.1');
    });

    it('business-spec check pasa en el repo (subtipos, ui_target y docs generados)', () => {
        expect(runCheck()).toEqual([]);
    });
});

describe('compile: un test por defecto (C0 §3)', () => {
    it('YAML que no cumple el JSON Schema → SCHEMA_INVALID', () => {
        const d = clone();
        delete core(d, 'CORE.IDENTITY.NAME').qa_truth;
        expect(codes(d)).toContain('SCHEMA_INVALID');
    });

    it('enum inválido (nivel) → SCHEMA_INVALID', () => {
        const d = clone();
        core(d, 'CORE.IDENTITY.NAME').criticality.level = 'urgente';
        expect(codes(d)).toContain('SCHEMA_INVALID');
    });

    it('enum inválido (causa del gap_message) → INVALID_ENUM', () => {
        const d = clone();
        core(d, 'CORE.HOURS.REGULAR').readiness.gap_message.inventada = 'x';
        expect(codes(d)).toContain('INVALID_ENUM');
    });

    it('ID duplicado → DUPLICATE_ID', () => {
        const d = clone();
        d.core.requirements.push(JSON.parse(JSON.stringify(core(d, 'CORE.IDENTITY.NAME'))));
        expect(codes(d)).toContain('DUPLICATE_ID');
    });

    it('ID de extra que choca con una instancia de plantilla → DUPLICATE_ID', () => {
        const d = clone();
        const extra = JSON.parse(JSON.stringify(d.objects.objects[0].extra_requirements[0]));
        extra.id = 'OBJ.APPOINTMENT.CATALOG';
        d.objects.objects[0].extra_requirements.push(extra);
        expect(codes(d)).toContain('DUPLICATE_ID');
    });

    it('deprecated_by a un ID inexistente → UNKNOWN_REFERENCE', () => {
        const d = clone();
        core(d, 'CORE.CONTACT.SPECIAL').deprecated_by = 'CORE.NO.EXISTE';
        expect(codes(d)).toContain('UNKNOWN_REFERENCE');
    });

    it('override sobre un requisito inexistente → UNKNOWN_REFERENCE', () => {
        const d = clone();
        profile(d, 'P02').overrides['CORE.NO.EXISTE'] = 'bloqueante (R2)';
        expect(codes(d)).toContain('UNKNOWN_REFERENCE');
    });

    it('objeto por defecto de un perfil inexistente → UNKNOWN_REFERENCE', () => {
        const d = clone();
        profile(d, 'P08').objects_default = ['teletransporte'];
        expect(codes(d)).toContain('UNKNOWN_REFERENCE');
    });

    it('answers que no existe en intents.yaml → UNKNOWN_INTENT', () => {
        const d = clone();
        core(d, 'CORE.IDENTITY.NAME').answers.push('C99');
        expect(codes(d)).toContain('UNKNOWN_INTENT');
    });

    it('override que BAJA la criticidad sin ADR → OVERRIDE_LOWERS_WITHOUT_ADR (con ADR, se admite)', () => {
        const d = clone();
        profile(d, 'P02').overrides['CORE.PAYMENT.METHODS'] = 'necesario (R4): de prueba';
        expect(codes(d)).toContain('OVERRIDE_LOWERS_WITHOUT_ADR');
        profile(d, 'P02').overrides['CORE.PAYMENT.METHODS'] = { level: 'necesario', rule: 'R4', why: 'prueba', adr: '0009' };
        expect(codes(d)).not.toContain('OVERRIDE_LOWERS_WITHOUT_ADR');
    });

    it('nivel y regla incoherentes → LEVEL_RULE_MISMATCH', () => {
        const d = clone();
        core(d, 'CORE.IDENTITY.NAME').criticality.rule = 'R4';
        expect(codes(d)).toContain('LEVEL_RULE_MISMATCH');
    });

    it('applies_when con un átomo desconocido → UNEVALUABLE_EXPRESSION', () => {
        const d = clone();
        core(d, 'CORE.SERVICE_AREA').applies_when = 'tiene_moto';
        expect(codes(d)).toContain('UNEVALUABLE_EXPRESSION');
    });

    it('condición de override que no se puede evaluar → UNEVALUABLE_EXPRESSION', () => {
        const d = clone();
        d.objects.objects.find((o: any) => o.object === 'food_order').overrides['CORE.DELIVERY.TERMS'] = 'bloqueante (R2) si llueve mucho';
        expect(codes(d)).toContain('UNEVALUABLE_EXPRESSION');
    });

    it('requisito R1–R4 sin predicate_kind → UNEVALUABLE_PREDICATE', () => {
        const d = clone();
        delete core(d, 'CORE.PAYMENT.METHODS').readiness.predicate_kind;
        expect(codes(d)).toContain('UNEVALUABLE_PREDICATE');
    });

    it('predicate_kind custom sin evaluador → UNEVALUABLE_PREDICATE', () => {
        const d = clone();
        core(d, 'CORE.OFFER.NOT_OFFERED').readiness.predicate_kind = 'custom';
        expect(codes(d)).toContain('UNEVALUABLE_PREDICATE');
    });

    it('parámetros de un predicado genérico inválidos → PREDICATE_PARAMS_INVALID', () => {
        const d = clone();
        core(d, 'CORE.PAYMENT.METHODS').readiness.predicate_params = { path: 'methods' };
        expect(codes(d)).toContain('PREDICATE_PARAMS_INVALID');
    });

    it('evaluador registrado para un ID que no existe → EVALUATOR_PARITY', () => {
        const ids = [...Object.keys(require('../src/engine/evaluators').CUSTOM_EVALUATORS), 'CORE.FANTASMA'];
        expect(codes(clone(), { evaluatorIds: ids })).toContain('EVALUATOR_PARITY');
    });

    it('spec_version distinto entre archivos → VERSION_MISMATCH', () => {
        const d = clone();
        d.objects.spec_version = '0.9.0';
        expect(codes(d)).toContain('VERSION_MISMATCH');
    });

    it('subtipo en dos perfiles → DUPLICATE_SUBTYPE', () => {
        const d = clone();
        d.profiles.subtypes.P01.push('salud/dental');
        expect(codes(d)).toContain('DUPLICATE_SUBTYPE');
    });

    it('profiles.yaml no cubre exactamente los subtipos canónicos → SUBTYPE_COVERAGE', () => {
        const { spec } = compile(pristine);
        const canonical = [...Object.keys(spec.subtypeToProfile), 'nueva_industria/nuevo'];
        expect(checkExternal(spec, { canonicalSubtypes: canonical }).map(e => e.code)).toEqual(['SUBTYPE_COVERAGE']);
    });

    it('ui_target que no está en dashboard-page-access → UNKNOWN_UI_TARGET', () => {
        const { spec } = compile(pristine);
        const errors = checkExternal(spec, { uiTargetExists: p => p !== '/admin/settings/business-hours' });
        expect(errors.map(e => e.code)).toEqual(['UNKNOWN_UI_TARGET']);
        expect(errors[0].id).toBe('CORE.HOURS.REGULAR');
    });

    it('docs/domain/business-requirements.md desfasado → DOCS_STALE', () => {
        expect(runCheck({ currentDoc: '# versión vieja' }).map(e => e.code)).toEqual(['DOCS_STALE']);
    });

    it('el documento generado cambia cuando cambia la especificación', () => {
        const d = clone();
        core(d, 'CORE.IDENTITY.NAME').title = 'Otro título';
        expect(generateRequirementsDoc(compile(d).spec)).not.toBe(generateRequirementsDoc(compile(pristine).spec));
    });
});
