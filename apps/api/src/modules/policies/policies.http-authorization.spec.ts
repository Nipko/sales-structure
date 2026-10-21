import { randomBytes } from 'crypto';
import { request } from 'http';
import type { AddressInfo } from 'net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AuthService } from '../auth/auth.service';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

/** Actual HTTP/controller/JWT/role/tenant guards; user lookup and policy storage are synthetic. */
describe('policy HTTP authorization boundaries', () => {
    const tenantA = '11111111-1111-4111-8111-111111111111', tenantB = '22222222-2222-4222-8222-222222222222';
    const policyId = '33333333-3333-4333-8333-333333333333';
    const users: Record<string, any> = {
        agentA: { id: 'synthetic-agent', role: 'tenant_agent', tenantId: tenantA },
        adminB: { id: 'synthetic-admin', role: 'tenant_admin', tenantId: tenantB },
    };
    const secret = randomBytes(48).toString('hex');
    const jwt = new JwtService({ secret });
    const validateUser = jest.fn(async (payload: any) => users[payload.sub] ?? null);
    const policies = {
        listActive: jest.fn(), listVersions: jest.fn(), getActive: jest.fn(),
        getPublicBySlug: jest.fn(), upsert: jest.fn(), delete: jest.fn(),
    };
    let app: INestApplication, port: number;
    beforeAll(async () => {
        const module = await Test.createTestingModule({
            imports: [PassportModule], controllers: [PoliciesController],
            providers: [JwtStrategy, RolesGuard, TenantGuard,
                { provide: ConfigService, useValue: { getOrThrow: (key: string) => { if (key !== 'auth.jwtSecret') throw Error('unexpected_config'); return secret; } } },
                { provide: AuthService, useValue: { validateUser } },
                { provide: PoliciesService, useValue: policies },
            ],
        }).compile();
        app = module.createNestApplication({ logger: false });
        app.setGlobalPrefix('api/v1');
        await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
    });
    afterAll(async () => { await app?.close(); });
    beforeEach(() => { jest.clearAllMocks(); });
    function call(method: string, path: string, actor?: string, body?: any): Promise<{ status: number; body: any }> {
        const encoded = body === undefined ? undefined : JSON.stringify(body);
        return new Promise((resolve, reject) => {
            const req = request({ hostname: '127.0.0.1', port, path: '/api/v1/policies/' + path, method,
                headers: { ...(actor ? { authorization: 'Bearer ' + jwt.sign({ sub: actor }, { expiresIn: '2m' }) } : {}),
                    ...(encoded ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) } : {}) } }, res => {
                let data = ''; res.setEncoding('utf-8'); res.on('data', chunk => { data += chunk; });
                res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(data) }); } catch (e) { reject(e); } });
            });
            req.setTimeout(5000, () => req.destroy(Error('synthetic_http_timeout'))); req.on('error', reject);
            if (encoded) req.write(encoded); req.end();
        });
    }
    const noPolicyAccess = () => { for (const fn of Object.values(policies)) expect(fn).not.toHaveBeenCalled(); };
    const edit = { type: 'privacy', title: 'Synthetic title', content: 'Synthetic policy exact text' };
    it('POLICYHTTP_A_ANONYMOUS rejects private reads before user lookup or policy access', async () => {
        expect((await call('GET', tenantA)).status).toBe(401); expect(validateUser).not.toHaveBeenCalled(); noPolicyAccess();
    });
    it('POLICYHTTP_A_AGENT_EDIT denies own-tenant agent POST before service mutation', async () => {
        expect((await call('POST', tenantA, 'agentA', edit)).status).toBe(403); expect(validateUser).toHaveBeenCalledTimes(1); noPolicyAccess();
    });
    it('POLICYHTTP_A_AGENT_DELETE denies own-tenant agent DELETE before service mutation', async () => {
        expect((await call('DELETE', tenantA + '/' + policyId, 'agentA')).status).toBe(403); expect(validateUser).toHaveBeenCalledTimes(1); noPolicyAccess();
    });
    it('POLICYHTTP_B_CROSS_ADMIN denies a signed administrator requesting another tenant', async () => {
        expect((await call('POST', tenantA, 'adminB', edit)).status).toBe(403); expect(validateUser).toHaveBeenCalledTimes(1); noPolicyAccess();
    });
    it('POLICYHTTP_B_OWN_ADMIN scopes allowed POST to route tenant despite a forged body selector', async () => {
        const body = { ...edit, tenantId: tenantA };
        policies.upsert.mockResolvedValueOnce({ id: policyId, ...edit, version: 2 });
        const result = await call('POST', tenantB, 'adminB', body);
        expect(result.status).toBe(201); expect(result.body).toMatchObject({ success: true, data: { id: policyId, version: 2 } });
        expect(policies.upsert).toHaveBeenCalledTimes(1); expect(policies.upsert).toHaveBeenCalledWith(tenantB, body);
        for (const [name, fn] of Object.entries(policies)) if (name !== 'upsert') expect(fn).not.toHaveBeenCalled();
    });
    it('POLICYHTTP_B_PUBLIC serves the intended active public policy without invoking private readers', async () => {
        const active = { id: policyId, type: 'privacy', content: 'Synthetic published policy', version: 1 };
        policies.getPublicBySlug.mockResolvedValueOnce(active);
        const result = await call('GET', 'public/synthetic-business/privacy');
        expect(result).toEqual({ status: 200, body: { success: true, data: active } });
        expect(validateUser).not.toHaveBeenCalled(); expect(policies.getPublicBySlug).toHaveBeenCalledWith('synthetic-business', 'privacy');
        for (const [name, fn] of Object.entries(policies)) if (name !== 'getPublicBySlug') expect(fn).not.toHaveBeenCalled();
    });
    jest.setTimeout(30000);
});
