import { EvaluationRevisionService } from './evaluation-revision.service';
jest.mock('./evaluation-artifact', () => ({evaluationArtifactHash: () => 'artifact'}));

/** E2r/E2s: every model call of an evaluation hashed every dependency table of the tenant (ADR 0021). */
describe('evaluation freshness checks share recent captures per tenant', () => {
    const WINDOW = EvaluationRevisionService.FRESHNESS_WINDOW_MS;
    function harness() {
        let clock = 1_000_000;
        class Clocked extends EvaluationRevisionService { protected now() { return clock; } }
        const service = new Clocked({} as any, {} as any);
        const pending: Array<{tenantId: string; resolve: (v: any) => void; reject: (e: any) => void}> = [];
        jest.spyOn(service, 'capture').mockImplementation((tenantId: string) =>
            new Promise((resolve, reject) => pending.push({tenantId, resolve, reject})));
        const fresh = (tenantId: string) => (service as any).captureFresh(tenantId) as Promise<any>;
        const flush = () => new Promise(r => setImmediate(r));
        const advance = (ms: number) => { clock += ms; };
        return {service, pending, fresh, flush, advance};
    }

    it('a check inside the window joins the running capture', async () => {
        const h = harness();
        const a = h.fresh('t'); await h.flush();
        h.advance(WINDOW - 1);
        const b = h.fresh('t'); await h.flush();
        expect(h.pending).toHaveLength(1);
        h.pending[0].resolve({revision: 'r1'});
        await expect(a).resolves.toEqual({revision: 'r1'});
        await expect(b).resolves.toEqual({revision: 'r1'});
    });

    it('a check inside the window reuses the finished capture without hashing again', async () => {
        const h = harness();
        const a = h.fresh('t'); await h.flush(); h.pending[0].resolve({revision: 'r1'}); await a; await h.flush();
        h.advance(WINDOW);
        await expect(h.fresh('t')).resolves.toEqual({revision: 'r1'});
        expect(h.service.capture).toHaveBeenCalledTimes(1);
    });

    it('a check after the window gets a capture that starts after it', async () => {
        const h = harness();
        const a = h.fresh('t'); await h.flush(); h.pending[0].resolve({revision: 'r1'}); await a; await h.flush();
        h.advance(WINDOW + 1);
        const b = h.fresh('t'); await h.flush();
        expect(h.pending).toHaveLength(2);
        h.pending[1].resolve({revision: 'r2'});
        await expect(b).resolves.toEqual({revision: 'r2'});
    });

    it('callers past the window of a running capture share ONE later capture', async () => {
        const h = harness();
        const a = h.fresh('t'); await h.flush();
        h.advance(WINDOW + 1);
        const b = h.fresh('t'), c = h.fresh('t'); await h.flush();
        expect(h.pending).toHaveLength(1);
        h.pending[0].resolve({revision: 'r1'}); await a; await h.flush();
        expect(h.pending).toHaveLength(2);
        h.pending[1].resolve({revision: 'r2'});
        await expect(b).resolves.toEqual({revision: 'r2'});
        await expect(c).resolves.toEqual({revision: 'r2'});
        expect(h.service.capture).toHaveBeenCalledTimes(2);
    });

    it('a failed capture is never reused', async () => {
        const h = harness();
        const a = h.fresh('t'); await h.flush();
        h.pending[0].reject(new Error('evaluation_dependencies_unavailable'));
        await expect(a).rejects.toThrow('evaluation_dependencies_unavailable'); await h.flush();
        const b = h.fresh('t'); await h.flush();
        expect(h.pending).toHaveLength(2);
        h.pending[1].resolve({revision: 'r2'});
        await expect(b).resolves.toEqual({revision: 'r2'});
    });

    it('tenants do not share captures', async () => {
        const h = harness();
        h.fresh('a'); h.fresh('b'); await h.flush();
        expect(h.pending.map(p => p.tenantId)).toEqual(['a', 'b']);
    });
});
