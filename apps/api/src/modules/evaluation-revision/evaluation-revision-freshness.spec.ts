import { EvaluationRevisionService } from './evaluation-revision.service';
jest.mock('./evaluation-artifact', () => ({evaluationArtifactHash: () => 'artifact'}));

/** E2r: the freshness check of every model call hashed every dependency table, once per caller. */
describe('evaluation freshness checks coalesce per tenant', () => {
    function harness() {
        const service = new EvaluationRevisionService({} as any, {} as any);
        const pending: Array<{tenantId: string; resolve: (v: any) => void; reject: (e: any) => void}> = [];
        jest.spyOn(service, 'capture').mockImplementation((tenantId: string) =>
            new Promise((resolve, reject) => pending.push({tenantId, resolve, reject})));
        const fresh = (tenantId: string) => (service as any).captureFresh(tenantId) as Promise<any>;
        const flush = () => new Promise(r => setImmediate(r));
        return {service, pending, fresh, flush};
    }

    it('callers that arrive while a capture runs share ONE later capture, never the running one', async () => {
        const h = harness();
        const first = h.fresh('t');
        await h.flush();
        expect(h.pending).toHaveLength(1);
        const second = h.fresh('t'), third = h.fresh('t');
        await h.flush();
        expect(h.pending).toHaveLength(1); // they wait; nothing new starts while one runs
        h.pending[0].resolve({revision: 'r1'});
        await expect(first).resolves.toEqual({revision: 'r1'});
        await h.flush();
        expect(h.pending).toHaveLength(2); // the next capture starts only after the first ended
        h.pending[1].resolve({revision: 'r2'});
        await expect(second).resolves.toEqual({revision: 'r2'});
        await expect(third).resolves.toEqual({revision: 'r2'});
        expect(h.service.capture).toHaveBeenCalledTimes(2);
    });

    it('a caller after everything settled starts a fresh capture', async () => {
        const h = harness();
        const a = h.fresh('t'); await h.flush(); h.pending[0].resolve({revision: 'r1'}); await a;
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

    it('a failed running capture fails its own caller and still runs the next one', async () => {
        const h = harness();
        const first = h.fresh('t'); await h.flush();
        const second = h.fresh('t');
        h.pending[0].reject(new Error('evaluation_dependencies_unavailable'));
        await expect(first).rejects.toThrow('evaluation_dependencies_unavailable');
        await h.flush();
        expect(h.pending).toHaveLength(2);
        h.pending[1].resolve({revision: 'r2'});
        await expect(second).resolves.toEqual({revision: 'r2'});
    });
});
