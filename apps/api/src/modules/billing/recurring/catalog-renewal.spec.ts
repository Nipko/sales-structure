import { claimCatalogRenewal } from './catalog-renewal';
describe('catalogue renewal freezing', () => {
    const periodStart = new Date('2026-10-01');
    const sub = { id:'a',tenantId:'t', status:'active',engine:'internal',provider:'wompi',
        currentPeriodEnd:periodStart,chargeAmountCents:27690000,chargeCurrency:'COP',metadata:{billingCycle:'monthly'},
        tenant:{billingCountry:'CO'},plan:{slug:'starter',priceLocalOverrides:{CO:{currency:'COP',amountCents:29990000}}} };
    function harness(latest: any = null, overrides: any = {}) {
        const tx = {$queryRawUnsafe:jest.fn(),billingSubscription:{findUnique:jest.fn().mockResolvedValue({...sub,...overrides}),update:jest.fn()},
            billingChargeAttempt:{findFirst:jest.fn().mockResolvedValue(latest)},auditLog:{create:jest.fn()}};
        const prisma = {$transaction: (fn: any) => fn(tx)};
        const engine = {claimAttempt:jest.fn().mockResolvedValue({id:'attempt'})};
        return {tx,engine,run:()=>claimCatalogRenewal(prisma,engine,{subscriptionId:'a',periodStart})};
    }
    beforeEach(()=> {process.env.WOMPI_MAX_TRANSACTION_COP_CENTS='1000000000';});
    it('freezes the catalogue and attempt in the same transaction',async()=>{
        const h=harness(); await h.run();
        expect(h.tx.billingSubscription.update).toHaveBeenCalledWith({where:{id:'a'},data:{chargeAmountCents:29990000}});
        expect(h.engine.claimAttempt).toHaveBeenCalledWith(expect.objectContaining({amountCents:29990000,currency:'COP'}),h.tx);
        expect(h.tx.auditLog.create).toHaveBeenCalled();
    });
    it.each(['in_flight','pending_provider','scheduled','succeeded','failed'])('preserves %s attempt',async status=>{
        const h=harness({status});expect(await h.run()).toBeNull();expect(h.engine.claimAttempt).not.toHaveBeenCalled();
        expect(h.tx.billingSubscription.update).not.toHaveBeenCalled();
    });
    it('never reinterprets a payment mandate in a different currency',async()=>{
        const h=harness(null,{chargeCurrency:'USD'});await expect(h.run()).rejects.toThrow('renewal_currency_changed');
        expect(h.engine.claimAttempt).not.toHaveBeenCalled();
    });
});
