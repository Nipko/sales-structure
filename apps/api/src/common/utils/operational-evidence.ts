/**
 * ═══ WHAT MAY LEAVE THE HOST WHEN SOMETHING IS BEING PROVEN ═══
 *
 * The October cut-over runs on the VPS that already serves tenants. Every
 * artefact it produces — a log tail, a migration report, a smoke result — is
 * evidence gathered from a live system, and it lands in a CI artifact store with
 * different retention and different access than the database it came from.
 *
 * So nothing that identifies a person crosses that boundary. Counters, states,
 * durations, error codes and ids: yes. A message body, an email, a phone number,
 * a bearer token or a session: no. "It is only staging" was never a reason and
 * there is no staging any more; this is the operational host.
 *
 * The redaction runs on OUR side before upload rather than on the host, so a
 * host that is already misbehaving cannot decide what gets published.
 */

/** Replaces the shapes that identify a person or grant access. */
export function redactForEvidence(text: string): string {
    return String(text ?? '')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
        // A run of 7+ digits with optional separators. Long enough not to eat a
        // counter, short enough to catch every national format we serve.
        .replace(/\+?\d[\d ()-]{6,}\d/g, '<phone>')
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '<token>')
        .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<jwt>')
        // Meta and provider tokens are long opaque strings with a known prefix.
        .replace(/\bEA[A-Za-z0-9]{20,}\b/g, '<meta_token>')
        .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, '<provider_key>');
}

/**
 * A line worth keeping in an evidence file.
 *
 * A 400-line tail of an application log is mostly noise, and noise is where an
 * unredacted shape hides. Keep the levels an operator reads and drop the rest,
 * so what gets published is small enough for a person to actually check.
 */
export function isEvidenceWorthy(line: string): boolean {
    return /\b(ERROR|WARN|FATAL)\b/.test(line) || /::(error|warning)::/.test(line)
        || /\b(MIGRATE_TENANTS_SUMMARY|AGREED_TERMS_PREFLIGHT|VPS_INVENTORY)\b/.test(line);
}

/** Both together: the only function an evidence collector should need. */
export function evidenceFrom(raw: string, limit = 400): string {
    return String(raw ?? '')
        .split(/\r?\n/)
        .filter(isEvidenceWorthy)
        .slice(-limit)
        .map(redactForEvidence)
        .join('\n');
}
