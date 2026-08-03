'use strict';

/**
 * Read-only Mercado Pago collector preflight for Colombia (MCO).
 *
 * It intentionally performs only these GET requests:
 *   1. Mercado Libre /users/me
 *   2. Mercado Libre /users/{id}?attributes=status
 *   3. Mercado Pago /preapproval_plan/search?limit=1
 *
 * Usage:
 *   MP_ACCESS_TOKEN=... node scripts/diagnose-mp-collector.js \
 *     --expected-site=MCO --expected-collector-id=<numeric-id>
 *
 * MCO is the only supported expected site. The expected collector can instead
 * be supplied through MP_EXPECTED_COLLECTOR_ID. Its value is only compared in
 * memory and is never included in the report.
 *
 * The JSON report never includes the token, collector id, nickname, plan ids,
 * plan reasons, email addresses, phone numbers, or other raw response bodies.
 */

const ENDPOINTS = Object.freeze({
    usersMe: 'https://api.mercadolibre.com/users/me',
    userStatus: (collectorId) =>
        `https://api.mercadolibre.com/users/${encodeURIComponent(collectorId)}?attributes=status`,
    planSearch: 'https://api.mercadopago.com/preapproval_plan/search?limit=1',
});

const ENDPOINT_LABELS = Object.freeze({
    usersMe: '/users/me',
    userStatus: '/users/{collector_id}?attributes=status',
    planSearch: '/preapproval_plan/search?limit=1',
});

const EXPECTED_SITE_ID = 'MCO';
const DEFAULT_TIMEOUT_MS = 10_000;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyRequiredAction(value) {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (isRecord(value)) return Object.keys(value).length === 0;
    return false;
}

function redactText(value, redactions = []) {
    let text = String(value);

    for (const secret of redactions) {
        if (typeof secret === 'string' && secret.length > 0) {
            text = text.split(secret).join('[REDACTED]');
        }
    }

    return text
        .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:APP_USR|TEST)-[^\s,;]+/gi, '[REDACTED_TOKEN]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
        .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED_PHONE]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]')
        .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, '[REDACTED_TOKEN]')
        .slice(0, 500);
}

function sanitizeCode(value, redactions) {
    if (typeof value === 'string' || typeof value === 'number') {
        return redactText(value, redactions);
    }
    if (isRecord(value) && (typeof value.code === 'string' || typeof value.code === 'number')) {
        return redactText(value.code, redactions);
    }
    return 'unrecognized_code';
}

function sanitizeCodes(value, redactions) {
    if (!Array.isArray(value)) return null;
    return value.slice(0, 20).map((entry) => sanitizeCode(entry, redactions));
}

function sanitizeRequiredAction(value, redactions) {
    if (isEmptyRequiredAction(value)) return null;
    if (typeof value === 'string' || typeof value === 'number') {
        return redactText(value, redactions);
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map((entry) => sanitizeCode(entry, redactions));
    }
    if (isRecord(value)) {
        const action = value.code ?? value.action ?? value.type;
        return action === undefined ? 'present' : sanitizeCode(action, redactions);
    }
    return 'present';
}

function sanitizePermission(value, redactions) {
    if (!isRecord(value)) {
        return { allow: null, codes: null };
    }
    return {
        allow: typeof value.allow === 'boolean' ? value.allow : null,
        codes: sanitizeCodes(value.codes, redactions),
    };
}

function sanitizeStatus(value, redactions) {
    if (!isRecord(value)) return null;
    return {
        site_status: typeof value.site_status === 'string'
            ? redactText(value.site_status, redactions)
            : null,
        required_action: sanitizeRequiredAction(value.required_action, redactions),
        mercadopago_tc_accepted: typeof value.mercadopago_tc_accepted === 'boolean'
            ? value.mercadopago_tc_accepted
            : null,
        billing: sanitizePermission(value.billing, redactions),
        sell: sanitizePermission(value.sell, redactions),
        list: sanitizePermission(value.list, redactions),
    };
}

function sanitizeUsersMeBody(body, redactions) {
    if (!isRecord(body)) return { kind: 'unexpected_body_shape' };
    return {
        site_id: typeof body.site_id === 'string' ? redactText(body.site_id, redactions) : null,
        collector_id_present: normalizeCollectorId(body.id) !== null,
        status: sanitizeStatus(body.status, redactions),
    };
}

function sanitizeUserStatusBody(body, redactions) {
    if (!isRecord(body)) return { kind: 'unexpected_body_shape' };
    return { status: sanitizeStatus(body.status, redactions) };
}

function sanitizePlanSearchBody(body, redactions) {
    if (!isRecord(body)) return { kind: 'unexpected_body_shape' };

    const results = Array.isArray(body.results) ? body.results : null;
    const statusCounts = {};
    if (results) {
        for (const result of results) {
            if (!isRecord(result) || typeof result.status !== 'string') continue;
            const status = redactText(result.status, redactions);
            statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        }
    }

    const paging = isRecord(body.paging) ? body.paging : null;
    return {
        paging: paging
            ? {
                total: Number.isFinite(paging.total) ? paging.total : null,
                limit: Number.isFinite(paging.limit) ? paging.limit : null,
                offset: Number.isFinite(paging.offset) ? paging.offset : null,
            }
            : null,
        result_count: results ? results.length : null,
        result_status_counts: statusCounts,
    };
}

function sanitizeErrorBody(body, redactions) {
    if (!isRecord(body)) {
        return body === null
            ? { kind: 'empty_error_body' }
            : { kind: 'unrecognized_error_body' };
    }

    const sanitized = {};
    for (const key of ['error', 'code', 'status']) {
        if (typeof body[key] === 'string' || typeof body[key] === 'number') {
            sanitized[key] = redactText(body[key], redactions);
        }
    }

    if (typeof body.message === 'string') {
        const messageCode = redactText(body.message, redactions);
        if (/^[a-z0-9]+(?:[_:.-][a-z0-9]+)+$/i.test(messageCode)) {
            sanitized.message_code = messageCode;
        } else {
            sanitized.message_omitted = true;
        }
    }

    const causes = Array.isArray(body.cause)
        ? body.cause
        : (isRecord(body.cause) ? [body.cause] : []);
    if (causes.length > 0) {
        sanitized.cause = causes.slice(0, 10).map((cause) => {
            if (!isRecord(cause)) return { code: sanitizeCode(cause, redactions) };
            const item = {};
            if (cause.code !== undefined) item.code = sanitizeCode(cause.code, redactions);
            if (typeof cause.description === 'string') {
                const descriptionCode = redactText(cause.description, redactions);
                if (/^[a-z0-9]+(?:[_:.-][a-z0-9]+)+$/i.test(descriptionCode)) {
                    item.description_code = descriptionCode;
                } else {
                    item.description_omitted = true;
                }
            }
            return Object.keys(item).length > 0 ? item : { code: 'unrecognized_cause' };
        });
    }

    return Object.keys(sanitized).length > 0
        ? sanitized
        : { kind: 'unrecognized_error_body' };
}

function normalizeCollectorId(value) {
    if (Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === 'string' && /^\d{1,32}$/.test(value)) return value;
    return null;
}

function getRequestId(headers, redactions) {
    if (!headers || typeof headers.get !== 'function') return null;
    const value = headers.get('x-request-id');
    return typeof value === 'string' && value.length > 0
        ? redactText(value, redactions)
        : null;
}

async function getJson({
    url,
    endpoint,
    accessToken,
    fetchImpl,
    timeoutMs,
    redactions,
    sanitizeSuccess,
}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            redirect: 'error',
            signal: controller?.signal,
        });

        const httpStatus = typeof response?.status === 'number' ? response.status : null;
        const httpOk = typeof response?.ok === 'boolean'
            ? response.ok
            : (httpStatus !== null && httpStatus >= 200 && httpStatus < 300);
        const xRequestId = getRequestId(response?.headers, redactions);

        let rawText;
        try {
            rawText = await response.text();
        } catch (error) {
            return {
                httpOk,
                jsonOk: false,
                data: null,
                failure: 'response_body_read_error',
                snapshot: {
                    endpoint,
                    method: 'GET',
                    http_status: httpStatus,
                    ok: false,
                    x_request_id: xRequestId,
                    body: {
                        error: 'response_body_read_error',
                        message: redactText(error instanceof Error ? error.message : error, redactions),
                    },
                },
            };
        }

        let data = null;
        let jsonOk = true;
        if (rawText.length > 0) {
            try {
                data = JSON.parse(rawText);
            } catch {
                jsonOk = false;
            }
        }

        const sanitizedBody = jsonOk
            ? (httpOk ? sanitizeSuccess(data, redactions) : sanitizeErrorBody(data, redactions))
            : {
                kind: 'non_json_body_omitted',
                byte_length: Buffer.byteLength(rawText, 'utf8'),
            };

        return {
            httpOk,
            jsonOk,
            data,
            failure: !httpOk ? 'http_error' : (!jsonOk ? 'invalid_json' : null),
            snapshot: {
                endpoint,
                method: 'GET',
                http_status: httpStatus,
                ok: httpOk && jsonOk,
                x_request_id: xRequestId,
                body: sanitizedBody,
            },
        };
    } catch (error) {
        return {
            httpOk: false,
            jsonOk: false,
            data: null,
            failure: 'network_error',
            snapshot: {
                endpoint,
                method: 'GET',
                http_status: null,
                ok: false,
                x_request_id: null,
                body: {
                    error: 'network_error',
                    message: redactText(error instanceof Error ? error.message : error, redactions),
                },
            },
        };
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function addRequestFailure(blockers, result, endpoint) {
    if (result.failure === 'http_error') {
        blockers.push({
            code: 'endpoint_http_error',
            endpoint,
            expected: 'HTTP 2xx JSON response',
            actual: `HTTP ${result.snapshot.http_status ?? 'unknown'}`,
        });
        return true;
    }
    if (result.failure === 'invalid_json' || result.failure === 'response_body_read_error') {
        blockers.push({
            code: 'endpoint_invalid_response',
            endpoint,
            expected: 'valid JSON response',
            actual: result.failure,
        });
        return true;
    }
    if (result.failure === 'network_error') {
        blockers.push({
            code: 'endpoint_unreachable',
            endpoint,
            expected: 'successful read-only request',
            actual: 'network_error',
        });
        return true;
    }
    return false;
}

function validateCollectorStatus(status, blockers, redactions) {
    if (!isRecord(status)) {
        blockers.push({
            code: 'collector_status_missing',
            endpoint: ENDPOINT_LABELS.userStatus,
            expected: 'status object',
            actual: 'missing_or_invalid',
        });
        return;
    }

    if (!isEmptyRequiredAction(status.required_action)) {
        blockers.push({
            code: 'required_action_present',
            endpoint: ENDPOINT_LABELS.userStatus,
            expected: null,
            actual: sanitizeRequiredAction(status.required_action, redactions),
        });
    }

    if (status.site_status !== 'active') {
        blockers.push({
            code: 'site_status_not_active',
            endpoint: ENDPOINT_LABELS.userStatus,
            expected: 'active',
            actual: typeof status.site_status === 'string'
                ? redactText(status.site_status, redactions)
                : null,
        });
    }

    if (status.mercadopago_tc_accepted !== true) {
        blockers.push({
            code: 'mercadopago_terms_not_accepted',
            endpoint: ENDPOINT_LABELS.userStatus,
            expected: true,
            actual: typeof status.mercadopago_tc_accepted === 'boolean'
                ? status.mercadopago_tc_accepted
                : null,
        });
    }

    for (const permissionName of ['billing', 'sell', 'list']) {
        const permission = status[permissionName];
        if (!isRecord(permission)) {
            blockers.push({
                code: 'permission_missing',
                endpoint: ENDPOINT_LABELS.userStatus,
                permission: permissionName,
                expected: '{ allow: true, codes: [] }',
                actual: 'missing_or_invalid',
            });
            continue;
        }

        if (permission.allow !== true) {
            blockers.push({
                code: 'permission_not_allowed',
                endpoint: ENDPOINT_LABELS.userStatus,
                permission: permissionName,
                expected: true,
                actual: typeof permission.allow === 'boolean' ? permission.allow : null,
            });
        }

        if (!Array.isArray(permission.codes)) {
            blockers.push({
                code: 'permission_codes_missing',
                endpoint: ENDPOINT_LABELS.userStatus,
                permission: permissionName,
                expected: [],
                actual: null,
            });
        } else if (permission.codes.length > 0) {
            blockers.push({
                code: 'permission_codes_present',
                endpoint: ENDPOINT_LABELS.userStatus,
                permission: permissionName,
                expected: [],
                actual: sanitizeCodes(permission.codes, redactions),
            });
        }
    }
}

function createReport(now) {
    const value = typeof now === 'function' ? now() : now;
    const date = value instanceof Date ? value : new Date(value ?? Date.now());
    return {
        schema_version: 1,
        mode: 'read_only',
        ok: false,
        checked_at: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
        expected_site_id: EXPECTED_SITE_ID,
        read_only_scope: {
            mutations_performed: false,
            write_eligibility_tested: false,
            note: 'GET /preapproval_plan/search does not prove that POST /preapproval_plan is allowed.',
        },
        collector_identity: {
            expected_configured: false,
            matches: null,
        },
        requests: [],
        blockers: [],
        warnings: [],
    };
}

function expectedSiteFromArgs(argv) {
    const inline = argv.find((arg) => arg.startsWith('--expected-site='));
    if (inline) return inline.slice('--expected-site='.length).trim().toUpperCase();

    const index = argv.indexOf('--expected-site');
    if (index >= 0 && typeof argv[index + 1] === 'string') {
        return argv[index + 1].trim().toUpperCase();
    }

    return EXPECTED_SITE_ID;
}

function expectedCollectorIdFromArgs(argv, env) {
    const inline = argv.find((arg) => arg.startsWith('--expected-collector-id='));
    if (inline) return inline.slice('--expected-collector-id='.length).trim();

    const index = argv.indexOf('--expected-collector-id');
    if (index >= 0) {
        return typeof argv[index + 1] === 'string' ? argv[index + 1].trim() : '';
    }

    return env.MP_EXPECTED_COLLECTOR_ID;
}

async function diagnoseCollector(options = {}) {
    const {
        accessToken,
        fetchImpl = globalThis.fetch,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        now = () => new Date(),
        expectedSiteId = EXPECTED_SITE_ID,
        expectedCollectorId,
    } = options;
    const report = createReport(now);

    const expectedCollectorConfigured = (
        (typeof expectedCollectorId === 'string' && expectedCollectorId.trim().length > 0)
        || (typeof expectedCollectorId === 'number' && Number.isFinite(expectedCollectorId))
    );
    const normalizedExpectedCollectorId = expectedCollectorConfigured
        ? normalizeCollectorId(expectedCollectorId)
        : null;
    report.collector_identity.expected_configured = expectedCollectorConfigured;

    if (!expectedCollectorConfigured) {
        report.warnings.push({
            code: 'collector_identity_not_pinned',
            endpoint: 'configuration',
            message: 'Set --expected-collector-id or MP_EXPECTED_COLLECTOR_ID to detect a wrong collector credential.',
        });
    } else if (normalizedExpectedCollectorId === null) {
        report.blockers.push({
            code: 'expected_collector_id_invalid',
            endpoint: 'configuration',
            expected: 'positive numeric collector id',
            actual: 'invalid_value_omitted',
        });
    }

    if (expectedSiteId !== EXPECTED_SITE_ID) {
        report.blockers.push({
            code: 'unsupported_expected_site',
            endpoint: 'configuration',
            expected: EXPECTED_SITE_ID,
            actual: typeof expectedSiteId === 'string'
                ? redactText(expectedSiteId)
                : null,
        });
        return report;
    }

    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
        report.blockers.push({
            code: 'missing_access_token',
            endpoint: 'configuration',
            expected: 'MP_ACCESS_TOKEN or MERCADOPAGO_ACCESS_TOKEN',
            actual: 'not_set',
        });
        return report;
    }

    if (typeof fetchImpl !== 'function') {
        report.blockers.push({
            code: 'fetch_unavailable',
            endpoint: 'runtime',
            expected: 'Node.js 20+ native fetch',
            actual: 'not_available',
        });
        return report;
    }

    const redactions = [accessToken];
    const requestOptions = { accessToken, fetchImpl, timeoutMs, redactions };

    const usersMe = await getJson({
        ...requestOptions,
        url: ENDPOINTS.usersMe,
        endpoint: ENDPOINT_LABELS.usersMe,
        sanitizeSuccess: sanitizeUsersMeBody,
    });
    report.requests.push(usersMe.snapshot);

    let collectorId = null;
    if (!addRequestFailure(report.blockers, usersMe, ENDPOINT_LABELS.usersMe)) {
        if (!isRecord(usersMe.data)) {
            report.blockers.push({
                code: 'users_me_body_invalid',
                endpoint: ENDPOINT_LABELS.usersMe,
                expected: 'object with id and site_id',
                actual: 'missing_or_invalid',
            });
        } else {
            if (typeof usersMe.data.nickname === 'string' && usersMe.data.nickname.length > 0) {
                redactions.push(usersMe.data.nickname);
            }

            collectorId = normalizeCollectorId(usersMe.data.id);
            if (collectorId === null) {
                report.blockers.push({
                    code: 'collector_id_missing',
                    endpoint: ENDPOINT_LABELS.usersMe,
                    expected: 'numeric collector id',
                    actual: 'missing_or_invalid',
                });
            }

            if (collectorId !== null && normalizedExpectedCollectorId !== null) {
                const matches = collectorId === normalizedExpectedCollectorId;
                report.collector_identity.matches = matches;
                if (!matches) {
                    report.blockers.push({
                        code: 'collector_identity_mismatch',
                        endpoint: ENDPOINT_LABELS.usersMe,
                        expected: 'configured collector identity',
                        actual: 'different collector identity',
                    });
                }
            }

            if (usersMe.data.site_id !== EXPECTED_SITE_ID) {
                report.blockers.push({
                    code: 'site_id_mismatch',
                    endpoint: ENDPOINT_LABELS.usersMe,
                    expected: EXPECTED_SITE_ID,
                    actual: typeof usersMe.data.site_id === 'string'
                        ? redactText(usersMe.data.site_id, redactions)
                        : null,
                });
            }
        }
    }

    if (collectorId !== null) {
        const userStatus = await getJson({
            ...requestOptions,
            url: ENDPOINTS.userStatus(collectorId),
            endpoint: ENDPOINT_LABELS.userStatus,
            sanitizeSuccess: sanitizeUserStatusBody,
        });
        report.requests.push(userStatus.snapshot);

        if (!addRequestFailure(report.blockers, userStatus, ENDPOINT_LABELS.userStatus)) {
            const status = isRecord(userStatus.data) ? userStatus.data.status : null;
            validateCollectorStatus(status, report.blockers, redactions);
        }
    }

    const planSearch = await getJson({
        ...requestOptions,
        url: ENDPOINTS.planSearch,
        endpoint: ENDPOINT_LABELS.planSearch,
        sanitizeSuccess: sanitizePlanSearchBody,
    });
    report.requests.push(planSearch.snapshot);

    if (!addRequestFailure(report.blockers, planSearch, ENDPOINT_LABELS.planSearch)) {
        if (!isRecord(planSearch.data) || !Array.isArray(planSearch.data.results)) {
            report.blockers.push({
                code: 'plan_search_body_invalid',
                endpoint: ENDPOINT_LABELS.planSearch,
                expected: 'object with results array',
                actual: 'missing_or_invalid',
            });
        }
    }

    report.ok = report.blockers.length === 0;
    return report;
}

async function runCli(options = {}) {
    const env = options.env ?? process.env;
    const argv = options.argv ?? process.argv.slice(2);
    const accessToken = env.MP_ACCESS_TOKEN || env.MERCADOPAGO_ACCESS_TOKEN;
    const write = options.write ?? ((chunk) => process.stdout.write(chunk));
    const report = await diagnoseCollector({
        accessToken,
        fetchImpl: options.fetchImpl ?? globalThis.fetch,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        now: options.now ?? (() => new Date()),
        expectedSiteId: expectedSiteFromArgs(argv),
        expectedCollectorId: expectedCollectorIdFromArgs(argv, env),
    });
    write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 2;
}

if (require.main === module) {
    runCli()
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .catch((error) => {
            const report = createReport(() => new Date());
            const secrets = [
                process.env.MP_ACCESS_TOKEN,
                process.env.MERCADOPAGO_ACCESS_TOKEN,
            ].filter((value) => typeof value === 'string');
            report.blockers.push({
                code: 'unexpected_diagnostic_failure',
                endpoint: 'runtime',
                expected: 'completed read-only diagnostic',
                actual: redactText(error instanceof Error ? error.message : error, secrets),
            });
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
            process.exitCode = 2;
        });
}

module.exports = {
    ENDPOINTS,
    diagnoseCollector,
    runCli,
};
