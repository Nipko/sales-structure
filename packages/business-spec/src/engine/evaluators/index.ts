/**
 * Registro de evaluadores. La CI exige paridad en las dos direcciones (compile.ts, EVALUATOR_PARITY):
 * todo requisito `custom` tiene evaluador y todo evaluador corresponde a un requisito `custom`.
 * Las plantillas se registran con su ID de plantilla (OBJ.*.X) y valen para cada objeto.
 */
import type { Evaluator } from '../primitives';
import { CORE_EVALUATORS } from './core';
import { GENERIC_EVALUATORS } from './generic';
import { OBJECT_EVALUATORS } from './objects';
import { PROFILE_DOMAIN_EVALUATORS } from './profiles-domains';

export const CUSTOM_EVALUATORS: Readonly<Record<string, Evaluator>> = {
    ...CORE_EVALUATORS,
    ...OBJECT_EVALUATORS,
    ...PROFILE_DOMAIN_EVALUATORS,
};

export const CUSTOM_EVALUATOR_IDS: readonly string[] = Object.keys(CUSTOM_EVALUATORS).sort();

export { GENERIC_EVALUATORS };
