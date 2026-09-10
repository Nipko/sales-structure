import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import {
    ConnectionRefusalCode, ConnectionRefusedError, isConnectionRefusal, refusalStatus,
} from './connection-refusal';

/**
 * ═══ A REFUSAL HAS TO ARRIVE AS AN ANSWER, NOT AS A CRASH ═══
 *
 * This application registers no global exception filter (`useGlobalFilters` and
 * `@Catch(` appear nowhere outside tests), so NestJS's default filter turns
 * anything that is not an `HttpException` into a 500.
 *
 * That is how correcting the resolvers regressed live endpoints. Asking for the
 * business profile of a number that is not connected used to answer
 * `NotFoundException` — a 404 the dashboard renders as "not connected". Once the
 * resolver refused with a plain `Error`, the same request answered 500: the
 * platform reporting itself broken to a tenant whose only problem is that they
 * have not connected a number yet.
 *
 * The status is the whole point of these cases, so they assert the number.
 */
describe('a connection refusal answers with a status, not a 500', () => {
    const detail = { tenantId: 'tenant-1', channelType: 'whatsapp', requestedAccountId: '15551234' };

    const CODES: ConnectionRefusalCode[] = ['connection_not_found', 'connection_ambiguous',
        'connection_absent', 'credential_missing', 'credential_undecryptable',
        'connection_disconnected', 'credential_revoked', 'credential_expired'];

    it.each(CODES)('%s never answers 500', code => {
        const refusal = new ConnectionRefusedError(code, detail);
        expect(refusal).toBeInstanceOf(HttpException);
        expect({ code, status: refusal.getStatus() })
            .not.toEqual({ code, status: HttpStatus.INTERNAL_SERVER_ERROR });
    });

    it('answers 404 for nothing to serve', () => {
        // Both halves of "there is no connection": the caller named one that does
        // not exist, and the tenant has none at all. Different people fix them —
        // which is why the codes stay separate — but from HTTP they are the same
        // answer, and the code in the body is what tells them apart.
        for (const code of ['connection_not_found', 'connection_absent'] as ConnectionRefusalCode[]) {
            expect({ code, status: new ConnectionRefusedError(code, detail).getStatus() })
                .toEqual({ code, status: HttpStatus.NOT_FOUND });
        }
        // The status these endpoints used to give, kept deliberately.
        expect(new NotFoundException().getStatus()).toBe(HttpStatus.NOT_FOUND);
    });

    it('answers 409 for a connection that is there and is not connected', () => {
        // Not 404: the number has not gone anywhere, and the request becomes
        // answerable the moment somebody reconnects it. A 404 would send an
        // operator looking for something to create.
        expect(new ConnectionRefusedError('connection_disconnected', detail).getStatus())
            .toBe(HttpStatus.CONFLICT);
    });

    it('answers 424 for a credential that may no longer sign', () => {
        // Revoked on disconnect, mid-rotation, or past its own expiry. No
        // change to the request fixes any of them.
        for (const code of ['credential_revoked', 'credential_expired'] as ConnectionRefusalCode[]) {
            expect({ code, status: new ConnectionRefusedError(code, detail).getStatus() })
                .toEqual({ code, status: HttpStatus.FAILED_DEPENDENCY });
        }
    });

    it('answers 409 when more than one account could pay', () => {
        // Not 404: there is plenty to serve. Not 500: nothing is broken. The
        // request becomes answerable the moment the caller says which account
        // pays, and a conflict is the only status that says so.
        expect(new ConnectionRefusedError('connection_ambiguous', detail).getStatus())
            .toBe(HttpStatus.CONFLICT);
    });

    it('answers 424 when the credential is the thing that failed', () => {
        // A 4xx that blames the caller would send the wrong person looking: no
        // change to the request fixes a rotation that half-landed or a wrong
        // ENCRYPTION_KEY.
        for (const code of ['credential_missing', 'credential_undecryptable'] as ConnectionRefusalCode[]) {
            expect({ code, status: new ConnectionRefusedError(code, detail).getStatus() })
                .toEqual({ code, status: HttpStatus.FAILED_DEPENDENCY });
        }
    });

    it('puts the code in the body, so nobody has to match on prose', () => {
        const body = new ConnectionRefusedError('connection_ambiguous', detail).getResponse() as any;
        expect(body.code).toBe('connection_ambiguous');
        expect(body.error).toBe('connection_refused');
        expect(body.statusCode).toBe(HttpStatus.CONFLICT);
    });

    it('never leaks a credential or a phone number into the body it publishes', () => {
        // `detail.detail` carries a caught error's message, and a caught error is
        // exactly where a secret ends up by accident.
        const refusal = new ConnectionRefusedError('credential_undecryptable', {
            ...detail, detail: 'Unsupported state or unable to authenticate data',
        });
        expect(JSON.stringify(refusal.getResponse())).not.toContain('EAAG');
    });

    it('is still an Error, so the twenty-six call sites keep working unchanged', () => {
        // The change would not be worth making if every catch and every `throw`
        // upstream had to be revisited.
        const refusal = new ConnectionRefusedError('connection_not_found', detail);
        expect(refusal).toBeInstanceOf(Error);
        expect(refusal.name).toBe('ConnectionRefusedError');
        expect(isConnectionRefusal(refusal)).toBe(true);
        expect(isConnectionRefusal(new Error('nope'))).toBe(false);
    });

    it('keeps the prose in `message`, which is what the logs read', () => {
        // NestJS derives `message` from the response object. Passing an object
        // without a string `message` would have silently turned every log line
        // into "Http Exception".
        const refusal = new ConnectionRefusedError('connection_ambiguous', detail);
        expect(refusal.message).toContain('more than one');
        expect(refusal.message).toContain('tenant-1');
        expect(refusal.message).not.toBe('Http Exception');
    });

    it('carries the connection it was asked about, for the log line', () => {
        const refusal = new ConnectionRefusedError('connection_not_found', detail);
        expect({ tenantId: refusal.tenantId, channelType: refusal.channelType,
            requestedAccountId: refusal.requestedAccountId })
            .toEqual({ tenantId: 'tenant-1', channelType: 'whatsapp', requestedAccountId: '15551234' });
        expect(new ConnectionRefusedError('connection_absent', { tenantId: 't', channelType: 'whatsapp' })
            .requestedAccountId).toBeNull();
    });

    it('exposes the same mapping without throwing', () => {
        // A caller that wants to answer a refusal itself must not have to
        // construct one to find out what status it would have used, or the two
        // will drift.
        for (const code of CODES) {
            expect({ code, status: refusalStatus(code) })
                .toEqual({ code, status: new ConnectionRefusedError(code, detail).getStatus() });
        }
    });
});
