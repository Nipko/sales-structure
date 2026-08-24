export const SIGNUP_ATTRIBUTION_KEY = "signupAttribution";

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
    cycleIntent?: "monthly" | "annual";
    capturedAt: string;
}

const MAX = 160;
const clean = (value: string | null | undefined, max = MAX) => {
    const normalized = value?.trim();
    return normalized ? normalized.slice(0, max) : undefined;
};

export function captureSignupAttribution(
    search: string,
    referrer: string,
    now = new Date(),
): SignupAttribution {
    const params = new URLSearchParams(search);
    let referrerHost: string | undefined;
    try { referrerHost = clean(new URL(referrer).hostname.toLowerCase(), 100); } catch { /* direct visit */ }

    const utmSource = clean(params.get("utm_source"), 100);
    const declaredSource = clean(params.get("source"), 100);
    const source = utmSource || declaredSource || referrerHost || "direct";
    const cycle = params.get("cycle");

    return {
        source,
        sourcePath: clean(params.get("source_path")),
        utmSource,
        utmMedium: clean(params.get("utm_medium"), 100),
        utmCampaign: clean(params.get("utm_campaign")),
        utmContent: clean(params.get("utm_content")),
        utmTerm: clean(params.get("utm_term")),
        referrerHost,
        planIntent: clean(params.get("plan"), 80),
        countryIntent: clean(params.get("country"), 3)?.toUpperCase(),
        cycleIntent: cycle === "monthly" || cycle === "annual" ? cycle : undefined,
        capturedAt: now.toISOString(),
    };
}

export function saveSignupAttribution(value: SignupAttribution, storage: Storage = sessionStorage) {
    storage.setItem(SIGNUP_ATTRIBUTION_KEY, JSON.stringify(value));
}

export function readSignupAttribution(storage: Storage = sessionStorage): SignupAttribution | undefined {
    try {
        const parsed = JSON.parse(storage.getItem(SIGNUP_ATTRIBUTION_KEY) || "null");
        if (!parsed || typeof parsed !== "object" || typeof parsed.source !== "string") return undefined;
        return parsed as SignupAttribution;
    } catch {
        return undefined;
    }
}

export function clearSignupAttribution(storage: Storage = sessionStorage) {
    storage.removeItem(SIGNUP_ATTRIBUTION_KEY);
}
