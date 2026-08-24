export interface SignupAttribution {
    source: string;
    sourcePath?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    referrerHost?: string;
    planIntent?: string;
    countryIntent?: string;
    cycleIntent?: 'monthly' | 'annual';
    capturedAt?: string;
}

const text = (value: unknown, max: number): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const clean = Array.from(value.trim())
        .filter((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f;
        })
        .join('');
    return clean ? clean.slice(0, max) : undefined;
};

/** Keep acquisition telemetry bounded and free of arbitrary URL payloads. */
export function sanitizeSignupAttribution(value: unknown): SignupAttribution | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const utmSource = text(input.utmSource, 100);
    const source = utmSource || text(input.source, 100) || 'direct';
    const cycle = input.cycleIntent === 'monthly' || input.cycleIntent === 'annual'
        ? input.cycleIntent
        : undefined;
    const country = text(input.countryIntent, 3)?.toUpperCase();
    const capturedAt = text(input.capturedAt, 40);

    return {
        source,
        sourcePath: text(input.sourcePath, 160),
        utmSource,
        utmMedium: text(input.utmMedium, 100),
        utmCampaign: text(input.utmCampaign, 160),
        utmContent: text(input.utmContent, 160),
        utmTerm: text(input.utmTerm, 160),
        referrerHost: text(input.referrerHost, 100)?.toLowerCase(),
        planIntent: text(input.planIntent, 80),
        countryIntent: country && /^[A-Z]{2,3}$/.test(country) ? country : undefined,
        cycleIntent: cycle,
        capturedAt: capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? capturedAt : undefined,
    };
}
