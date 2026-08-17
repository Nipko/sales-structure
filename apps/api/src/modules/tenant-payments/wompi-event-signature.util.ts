import { createHash, timingSafeEqual } from 'crypto';

const REQUIRED_PROPERTIES = new Set([
    'transaction.id',
]);

export function verifyWompiEventSignature(input: {
    body: any;
    eventsSecret: string;
    headerChecksum?: string;
}): { valid: boolean; eventKey?: string; reason?: string } {
    const body = input.body;
    const properties = body?.signature?.properties;
    const timestamp = body?.timestamp;
    const bodyChecksum = normalizeChecksum(body?.signature?.checksum);
    const headerChecksum = normalizeChecksum(input.headerChecksum);
    if (!Array.isArray(properties) || properties.length < REQUIRED_PROPERTIES.size || properties.length > 12) {
        return { valid: false, reason: 'invalid_signature_properties' };
    }
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
        return { valid: false, reason: 'invalid_signature_timestamp' };
    }
    if (!bodyChecksum && !headerChecksum) return { valid: false, reason: 'missing_checksum' };
    if (bodyChecksum && headerChecksum && bodyChecksum !== headerChecksum) {
        return { valid: false, reason: 'checksum_headers_disagree' };
    }
    const supplied = headerChecksum || bodyChecksum!;

    const seen = new Set<string>();
    const signedValues: string[] = [];
    for (const rawProperty of properties) {
        const property = typeof rawProperty === 'string' ? rawProperty.trim() : '';
        // Wompi explicitly documents this list as dynamic. Accept bounded,
        // scalar transaction paths in the supplied order; path traversal and
        // objects/arrays remain forbidden, and the three settlement-critical
        // fields below are mandatory.
        if (!isAllowedDynamicProperty(property) || seen.has(property)) {
            return { valid: false, reason: 'unsupported_signature_property' };
        }
        seen.add(property);
        const value = readScalarPath(body?.data, property);
        if (value === undefined) return { valid: false, reason: 'missing_signature_value' };
        signedValues.push(String(value));
    }
    for (const required of REQUIRED_PROPERTIES) {
        if (!seen.has(required)) return { valid: false, reason: 'missing_required_signature_property' };
    }
    const expected = createHash('sha256')
        .update(`${signedValues.join('')}${timestamp}${input.eventsSecret}`)
        .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const suppliedBuffer = Buffer.from(supplied, 'hex');
    if (expectedBuffer.length !== suppliedBuffer.length
        || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
        return { valid: false, reason: 'checksum_mismatch' };
    }
    return { valid: true, eventKey: supplied };
}

function isAllowedDynamicProperty(property: string): boolean {
    if (property.length < 3 || property.length > 120) return false;
    const parts = property.split('.');
    return parts.length >= 2
        && parts.length <= 6
        && parts[0] === 'transaction'
        && parts.every(part => /^[a-z][a-z0-9_]*$/i.test(part)
            && part !== '__proto__'
            && part !== 'prototype'
            && part !== 'constructor');
}

function normalizeChecksum(value: unknown): string | undefined {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

function readScalarPath(root: unknown, path: string): string | number | boolean | undefined {
    let current: any = root;
    for (const part of path.split('.')) {
        if (!/^[a-z][a-z0-9_]*$/i.test(part)
            || part === '__proto__'
            || part === 'prototype'
            || part === 'constructor'
            || current === null
            || typeof current !== 'object'
            || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
        current = current[part];
    }
    return ['string', 'number', 'boolean'].includes(typeof current) ? current : undefined;
}
