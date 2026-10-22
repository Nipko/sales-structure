import { createHash } from 'crypto';

const FACTORS = ['engagement', 'intent', 'recency', 'stageProgress', 'profileCompleteness'] as const;
export interface EffectiveScoringConfiguration {
    weights: Record<typeof FACTORS[number], number>;
    keywords: string[];
    decayEnabled: boolean;
    decayDays: number;
    decayFactor: number;
}
export interface ScoringConfigurationReceipt {
    version: 1;
    algorithm: 'sha256';
    sha256: string;
}

/** Capture the exact effective parameters, without persisting keywords or weights.
 * Invalid legacy configurations keep their existing execution path, but earn no receipt.
 */
export function captureScoringConfiguration(value: unknown): {
    configuration: EffectiveScoringConfiguration;
    receipt: ScoringConfigurationReceipt;
} | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const c = value as EffectiveScoringConfiguration;
    if (!c.weights || typeof c.weights !== 'object'
        || FACTORS.some(key => typeof c.weights[key] !== 'number' || !Number.isFinite(c.weights[key]))
        || !Array.isArray(c.keywords) || c.keywords.some(word => typeof word !== 'string')
        || typeof c.decayEnabled !== 'boolean' || !Number.isFinite(c.decayDays) || typeof c.decayDays !== 'number'
        || !Number.isFinite(c.decayFactor) || typeof c.decayFactor !== 'number') return null;
    const weights = Object.fromEntries(FACTORS.map(key => [key, c.weights[key]])) as EffectiveScoringConfiguration['weights'];
    const keywords = [...c.keywords];
    const configuration: EffectiveScoringConfiguration = {
        weights, keywords, decayEnabled: c.decayEnabled, decayDays: c.decayDays, decayFactor: c.decayFactor,
    };
    const receipt: ScoringConfigurationReceipt = {
        version: 1, algorithm: 'sha256', sha256: createHash('sha256').update(JSON.stringify(configuration)).digest('hex'),
    };
    Object.freeze(weights); Object.freeze(keywords); Object.freeze(configuration); Object.freeze(receipt);
    return { configuration, receipt };
}

/** A missing/legacy receipt is never upgraded by guessing defaults or reading today's settings. */
export function matchesScoringConfigurationReceipt(receipt: unknown, configuration: unknown): boolean {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
    const r = receipt as ScoringConfigurationReceipt;
    if (Object.keys(r).sort().join(',') !== 'algorithm,sha256,version' || r.version !== 1
        || r.algorithm !== 'sha256' || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256)) return false;
    const captured = captureScoringConfiguration(configuration);
    return captured !== null && captured.receipt.sha256 === r.sha256;
}
