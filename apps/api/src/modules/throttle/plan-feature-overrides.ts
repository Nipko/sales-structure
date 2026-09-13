import { FEATURE_OVERRIDE_KEYS } from './plan-features.registry';

/** Numeric overrides are restricted to the same reviewed registry everywhere. */
export function applyPlanFeatureOverrides(base:Record<string,any>,overrides:Record<string,any>):Record<string,any>{
    const merged={...base};
    for(const key of FEATURE_OVERRIDE_KEYS)if(typeof overrides[key]==='number')merged[key]=overrides[key];
    return merged;
}
