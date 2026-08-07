type MockResponse = {
    ok: boolean;
    status: number;
    headers: { get: (name: string) => string | null };
    text: () => Promise<string>;
};

type DiagnosticReport = {
    ok: boolean;
    mode: string;
    read_only_scope: {
        mutations_performed: boolean;
        write_eligibility_tested: boolean;
        note: string;
    };
    collector_identity: {
        expected_configured: boolean;
        matches: boolean | null;
    };
    requests: Array<{
        endpoint: string;
        method: string;
        http_status: number | null;
        ok: boolean;
        x_request_id: string | null;
        body: Record<string, unknown>;
    }>;
    blockers: Array<{
        code: string;
        endpoint: string;
        permission?: string;
        actual?: unknown;
    }>;
    warnings: Array<{
        code: string;
        endpoint: string;
        message: string;
        permission?: string;
        actual?: unknown;
    }>;
};

type DiagnoseModule = {
    ENDPOINTS: {
        usersMe: string;
        userStatus: (id: string) => string;
        planSearch: string;
    };
    diagnoseCollector: (options: {
        accessToken?: string;
        fetchImpl?: jest.Mock;
        timeoutMs?: number;
        now?: () => Date;
        expectedCollectorId?: string | number;
    }) => Promise<DiagnosticReport>;
    runCli: (options: {
        env?: Record<string, string>;
        argv?: string[];
        fetchImpl?: jest.Mock;
        write?: (chunk: string) => void;
        timeoutMs?: number;
        now?: () => Date;
    }) => Promise<number>;
};

// The executable remains plain CommonJS so it can run in the production API
// image without ts-node. This spec lives under src because that is Jest's root.
// El require va en su propia línea para que el disable quede pegado a él: con el
// destructuring multilínea, ESLint reporta en la línea del require, no en la del
// `const`, y el disable-next-line no llegaba.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const diagnoseModule = require('../../scripts/diagnose-mp-collector.js') as DiagnoseModule;
const { ENDPOINTS, diagnoseCollector, runCli } = diagnoseModule;

const ACTIVE_STATUS = {
    site_status: 'active',
    required_action: null,
    mercadopago_tc_accepted: true,
    billing: { allow: true, codes: [] },
    sell: { allow: true, codes: [] },
    list: { allow: true, codes: [] },
};

function response(body: unknown, status = 200, requestId = 'req-test'): MockResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (name: string) => name.toLowerCase() === 'x-request-id' ? requestId : null,
        },
        text: async () => JSON.stringify(body),
    };
}

function queueFetch(...responses: MockResponse[]): jest.Mock {
    const fetchMock = jest.fn();
    for (const item of responses) fetchMock.mockResolvedValueOnce(item);
    return fetchMock;
}

describe('diagnose-mp-collector read-only preflight', () => {
    const token = 'APP_USR-do-not-print-this-token';
    const now = () => new Date('2026-08-03T15:00:00.000Z');

    it('passes a compliant MCO collector using only the three expected GET requests', async () => {
        const fetchMock = queueFetch(
            response({
                id: 123456789,
                nickname: 'private-nickname',
                email: 'owner@example.com',
                first_name: 'PrivateFirstName',
                last_name: 'PrivateLastName',
                company: { name: 'Private Company Name' },
                site_id: 'MCO',
                status: ACTIVE_STATUS,
            }, 200, 'req-me'),
            response({
                id: 123456789,
                nickname: 'private-nickname',
                status: ACTIVE_STATUS,
            }, 200, 'req-status'),
            response({
                paging: { total: 1, limit: 1, offset: 0 },
                results: [{
                    id: 'plan-private-id',
                    application_id: 987654321,
                    collector_id: 123456789,
                    reason: 'Private plan reason',
                    payer_email: 'payer@example.com',
                    status: 'active',
                }],
            }, 200, 'req-plan-search'),
        );

        const report = await diagnoseCollector({
            accessToken: token,
            expectedCollectorId: '123456789',
            fetchImpl: fetchMock,
            now,
        });

        expect(report.ok).toBe(true);
        expect(report.mode).toBe('read_only');
        expect(report.read_only_scope).toEqual({
            mutations_performed: false,
            write_eligibility_tested: false,
            note: 'GET /preapproval_plan/search does not prove that POST /preapproval_plan is allowed.',
        });
        expect(report.blockers).toEqual([]);
        expect(report.warnings).toEqual([]);
        expect(report.collector_identity).toEqual({
            expected_configured: true,
            matches: true,
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            ENDPOINTS.usersMe,
            ENDPOINTS.userStatus('123456789'),
            ENDPOINTS.planSearch,
        ]);

        for (const [, options] of fetchMock.mock.calls) {
            expect(options.method).toBe('GET');
            expect(options.body).toBeUndefined();
        }

        expect(report.requests.map((request) => request.x_request_id)).toEqual([
            'req-me',
            'req-status',
            'req-plan-search',
        ]);
        expect(report.requests[2].body).toEqual({
            paging: { total: 1, limit: 1, offset: 0 },
            result_count: 1,
            result_status_counts: { active: 1 },
        });

        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain(token);
        expect(serialized).not.toContain('private-nickname');
        expect(serialized).not.toContain('owner@example.com');
        expect(serialized).not.toContain('PrivateFirstName');
        expect(serialized).not.toContain('PrivateLastName');
        expect(serialized).not.toContain('Private Company Name');
        expect(serialized).not.toContain('payer@example.com');
        expect(serialized).not.toContain('123456789');
        expect(serialized).not.toContain('plan-private-id');
        expect(serialized).not.toContain('Private plan reason');
        expect(serialized).not.toContain('nickname');
    });

    it('blocks country, required action, account state and terms while reporting marketplace flags as warnings', async () => {
        const blockedStatus = {
            site_status: 'blocked',
            required_action: 'validate_identity',
            mercadopago_tc_accepted: false,
            billing: { allow: false, codes: ['kyc_pending'] },
            sell: { allow: true, codes: ['regulation_review'] },
            list: { allow: false, codes: null },
        };
        const fetchMock = queueFetch(
            response({ id: 999, nickname: 'hidden', site_id: 'MLM' }, 200, 'req-me'),
            response({ id: 999, nickname: 'hidden', status: blockedStatus }, 200, 'req-status'),
            response({ paging: { total: 0, limit: 1, offset: 0 }, results: [] }, 200, 'req-plan'),
        );

        const report = await diagnoseCollector({ accessToken: token, fetchImpl: fetchMock, now });
        const codes = report.blockers.map((blocker) => blocker.code);
        const warningCodes = report.warnings.map((warning) => warning.code);

        expect(report.ok).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(codes).toEqual(expect.arrayContaining([
            'site_id_mismatch',
            'required_action_present',
            'site_status_not_active',
            'mercadopago_terms_not_accepted',
        ]));
        expect(codes).not.toContain('permission_not_allowed');
        expect(codes).not.toContain('permission_codes_present');
        expect(codes).not.toContain('permission_codes_missing');
        expect(warningCodes).toEqual(expect.arrayContaining([
            'permission_not_allowed',
            'permission_codes_present',
            'permission_codes_missing',
        ]));
        expect(report.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'permission_not_allowed', permission: 'billing' }),
            expect.objectContaining({ code: 'permission_codes_present', permission: 'sell' }),
            expect.objectContaining({ code: 'permission_codes_missing', permission: 'list' }),
        ]));
    });

    it('does not block plan sync for address_pending in billing or list marketplace flags', async () => {
        const addressPendingStatus = {
            ...ACTIVE_STATUS,
            billing: { allow: false, codes: ['address_pending'] },
            list: { allow: false, codes: ['address_pending'] },
        };
        const fetchMock = queueFetch(
            response({ id: 456, nickname: 'private', site_id: 'MCO' }),
            response({ status: addressPendingStatus }),
            response({ paging: { total: 0, limit: 1, offset: 0 }, results: [] }),
        );
        const output: string[] = [];

        const exitCode = await runCli({
            env: {
                MP_ACCESS_TOKEN: token,
                MP_EXPECTED_COLLECTOR_ID: '456',
            },
            argv: ['--expected-site=MCO'],
            fetchImpl: fetchMock,
            write: (chunk) => output.push(chunk),
            now,
        });
        const report = JSON.parse(output[0]) as DiagnosticReport;

        expect(exitCode).toBe(0);
        expect(report.ok).toBe(true);
        expect(report.blockers).toEqual([]);
        expect(report.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'permission_not_allowed',
                permission: 'billing',
            }),
            expect.objectContaining({
                code: 'permission_codes_present',
                permission: 'billing',
                actual: ['address_pending'],
            }),
            expect.objectContaining({
                code: 'permission_not_allowed',
                permission: 'list',
            }),
            expect.objectContaining({
                code: 'permission_codes_present',
                permission: 'list',
                actual: ['address_pending'],
            }),
        ]));
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('captures HTTP status, sanitized error body and x-request-id without leaking secrets or PII', async () => {
        const fetchMock = queueFetch(
            response({ id: 321, nickname: 'hidden-nickname', site_id: 'MCO' }, 200, 'req-me'),
            response({
                error: 'forbidden',
                message: `Owner PrivateFirstName PrivateLastName owner@example.com with ${token} is blocked`,
                cause: [{
                    code: 'rejected_by_regulations_collector_non_compliant',
                    description: 'Contact PrivateFirstName at +57 300 123 4567 for review',
                    payer_email: 'never-print@example.com',
                }],
                nickname: 'hidden-nickname',
            }, 403, 'req-regulations'),
            response({
                error: 'forbidden',
                message: 'Search is blocked for account@example.com',
            }, 403, 'req-search'),
        );

        const report = await diagnoseCollector({ accessToken: token, fetchImpl: fetchMock, now });
        const statusRequest = report.requests[1];
        const serialized = JSON.stringify(report);

        expect(report.ok).toBe(false);
        expect(statusRequest.http_status).toBe(403);
        expect(statusRequest.x_request_id).toBe('req-regulations');
        expect(statusRequest.body).toEqual({
            error: 'forbidden',
            message_omitted: true,
            cause: [{
                code: 'rejected_by_regulations_collector_non_compliant',
                description_omitted: true,
            }],
        });
        expect(report.blockers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'endpoint_http_error',
                endpoint: '/users/{collector_id}?attributes=status',
            }),
            expect.objectContaining({
                code: 'endpoint_http_error',
                endpoint: '/preapproval_plan/search?limit=1',
            }),
        ]));
        expect(serialized).not.toContain(token);
        expect(serialized).not.toContain('hidden-nickname');
        expect(serialized).not.toContain('owner@example.com');
        expect(serialized).not.toContain('never-print@example.com');
        expect(serialized).not.toContain('account@example.com');
        expect(serialized).not.toContain('+57 300 123 4567');
        expect(serialized).not.toContain('PrivateFirstName');
        expect(serialized).not.toContain('PrivateLastName');
    });

    it('returns a non-zero CLI exit code and makes no request when the token is absent', async () => {
        const fetchMock = jest.fn();
        const output: string[] = [];

        const exitCode = await runCli({
            env: {},
            fetchImpl: fetchMock,
            write: (chunk) => output.push(chunk),
            now,
        });

        expect(exitCode).toBe(2);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(output).toHaveLength(1);
        expect(JSON.parse(output[0])).toEqual(expect.objectContaining({
            ok: false,
            mode: 'read_only',
            blockers: [expect.objectContaining({ code: 'missing_access_token' })],
        }));
    });

    it('returns a non-zero CLI exit code when any collector blocker is present', async () => {
        const fetchMock = queueFetch(
            response({ id: 456, nickname: 'private', site_id: 'MCO' }),
            response({ status: { ...ACTIVE_STATUS, required_action: ['verify_company'] } }),
            response({ paging: { total: 0, limit: 1, offset: 0 }, results: [] }),
        );
        const output: string[] = [];

        const exitCode = await runCli({
            env: { MP_ACCESS_TOKEN: token },
            argv: ['--expected-site=MCO', '--expected-collector-id=456'],
            fetchImpl: fetchMock,
            write: (chunk) => output.push(chunk),
            now,
        });
        const parsed = JSON.parse(output[0]);

        expect(exitCode).toBe(2);
        expect(parsed).toEqual(expect.objectContaining({
            ok: false,
            blockers: expect.arrayContaining([
                expect.objectContaining({ code: 'required_action_present' }),
            ]),
        }));
        expect(parsed.collector_identity).toEqual({
            expected_configured: true,
            matches: true,
        });
        expect(parsed.warnings).toEqual([]);
        expect(output[0]).not.toContain(token);
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    });

    it('warns without blocking when collector identity is not pinned', async () => {
        const fetchMock = queueFetch(
            response({ id: 654, nickname: 'private', site_id: 'MCO' }),
            response({ status: ACTIVE_STATUS }),
            response({ paging: { total: 0, limit: 1, offset: 0 }, results: [] }),
        );

        const report = await diagnoseCollector({ accessToken: token, fetchImpl: fetchMock, now });

        expect(report.ok).toBe(true);
        expect(report.collector_identity).toEqual({
            expected_configured: false,
            matches: null,
        });
        expect(report.warnings).toEqual([
            expect.objectContaining({ code: 'collector_identity_not_pinned' }),
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('blocks an unexpected collector from the env without printing either collector id', async () => {
        const fetchMock = queueFetch(
            response({ id: 741852963, nickname: 'private', site_id: 'MCO' }),
            response({ status: ACTIVE_STATUS }),
            response({ paging: { total: 0, limit: 1, offset: 0 }, results: [] }),
        );
        const output: string[] = [];

        const exitCode = await runCli({
            env: {
                MP_ACCESS_TOKEN: token,
                MP_EXPECTED_COLLECTOR_ID: '369258147',
            },
            argv: ['--expected-site=MCO'],
            fetchImpl: fetchMock,
            write: (chunk) => output.push(chunk),
            now,
        });
        const parsed = JSON.parse(output[0]);

        expect(exitCode).toBe(2);
        expect(parsed.collector_identity).toEqual({
            expected_configured: true,
            matches: false,
        });
        expect(parsed.blockers).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'collector_identity_mismatch' }),
        ]));
        expect(output[0]).not.toContain('741852963');
        expect(output[0]).not.toContain('369258147');
        expect(output[0]).not.toContain('private');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    });

    it('rejects a non-MCO expected-site flag without making requests', async () => {
        const fetchMock = jest.fn();
        const output: string[] = [];

        const exitCode = await runCli({
            env: { MP_ACCESS_TOKEN: token },
            argv: ['--expected-site=MLM'],
            fetchImpl: fetchMock,
            write: (chunk) => output.push(chunk),
            now,
        });

        expect(exitCode).toBe(2);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(JSON.parse(output[0])).toEqual(expect.objectContaining({
            expected_site_id: 'MCO',
            blockers: [expect.objectContaining({ code: 'unsupported_expected_site' })],
        }));
    });
});
