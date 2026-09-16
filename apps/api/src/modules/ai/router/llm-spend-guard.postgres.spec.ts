import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { LlmSpendGuardService, LlmBudgetExceeded } from './llm-spend-guard.service';
import { LLMRouterService } from './llm-router.service';
import { BillingAdminController } from '../../billing/billing-admin.controller';
import { validatePlanFeatures } from '../../throttle/plan-features.registry';

const url = process.env.PLAN_ECONOMICS_TEST_URL;
const suite = url ? describe : describe.skip;
suite('LLM money admission through PostgreSQL and the real router', () => {
    let db: PrismaClient;
    let tenantId: string;
    let slug: string;
    let guard: LlmSpendGuardService;
    const price = { id:'synthetic',costInPer1k:0,costOutPer1k:0.001,maxContextTokens:1000 };
    const request = {model:'synthetic',messages:[],maxTokens:6000};
    beforeAll(async()=>{
        const parsed = new URL(url!);
        if (!['localhost','127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.includes('plan_economics')) throw new Error('Disposable database required');
        db=new PrismaClient({datasources:{db:{url}}}); await db.$connect();
    });
    beforeEach(async()=>{
        tenantId=randomUUID();slug=`test-${tenantId}`;
        await db.billingPlan.create({data:{slug,name:'Synthetic plan',priceUsdCents:2900,maxAgents:1,maxAiMessages:1000,features:{llmHardBudgetUsdCents:1}}});
        await db.tenant.create({data:{id:tenantId,name:'Synthetic tenant',industry:'otro',slug,schemaName:`test_${tenantId.replace(/-/g,'')}`,plan:slug}});
        guard=new LlmSpendGuardService(db as any,{get:jest.fn().mockResolvedValue(null)} as any,{runExclusive:jest.fn()} as any);
    });
    afterEach(async()=>{ await db.tenant.delete({where:{id:tenantId}});await db.billingPlan.delete({where:{slug}}); });
    afterAll(async()=>{await db.$disconnect();});
    it('admits only one of two concurrent calls exceeding their shared cap',async()=>{
        const results=await Promise.allSettled([guard.reserve(tenantId,price,request),guard.reserve(tenantId,price,request)]);
        expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
        expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
        const rows=await db.llmSpendReservation.findMany({where:{tenantId}});
        expect(rows.reduce((n,r)=>n+Number(r.accountedMicro),0)).toBe(6000);
    });
    it('a provider timeout consumes its reserve and cannot finance another POST',async()=>{
        const provider:any={providerName:'test',generate:jest.fn().mockRejectedValue(new Error('timeout')),generateStream:jest.fn()};
        const wrapped=guard.wrap(provider,tenantId,price);
        await expect(wrapped.generate(request)).rejects.toThrow('timeout');
        await expect(wrapped.generate(request)).rejects.toBeInstanceOf(LlmBudgetExceeded);
        expect(provider.generate).toHaveBeenCalledTimes(1);
    });
    it('successful usage reconciles the reservation once without multiplying charges',async()=>{
        const provider:any={providerName:'test',generate:jest.fn().mockResolvedValue({content:'ok',finishReason:'stop',usage:{promptTokens:1,completionTokens:2,totalTokens:3}}),generateStream:jest.fn()};
        await guard.wrap(provider,tenantId,price).generate(request);
        const rows=await db.llmSpendReservation.findMany({where:{tenantId,basis:'reported_tokens_estimate'}});
        expect(rows).toHaveLength(1);expect(Number(rows[0].accountedMicro)).toBe(2);
        expect(provider.generate).toHaveBeenCalledWith(request,{maxRetries:0});
    });
    it('the actual direct and streaming router paths refuse before any provider invocation',async()=>{
        await db.billingPlan.update({where:{slug},data:{features:{llmHardBudgetUsdCents:0}}});
        const provider:any={providerName:'openai',generate:jest.fn(),generateStream:jest.fn()};
        const router=new LLMRouterService([provider],{} as any,{} as any,{} as any,guard);
        await expect(router.execute({model:'gpt-4o-mini',tenantId,messages:[]})).rejects.toBeInstanceOf(LlmBudgetExceeded);
        await expect(router.executeStream({model:'gpt-4o-mini',tenantId,messages:[]}).next()).rejects.toBeInstanceOf(LlmBudgetExceeded);
        expect(provider.generate).not.toHaveBeenCalled();expect(provider.generateStream).not.toHaveBeenCalled();
    });
    it('reads plan edits afresh, independent of a warm entitlement cache',async()=>{
        await guard.reserve(tenantId,price,request);
        await db.billingPlan.update({where:{slug},data:{features:{llmHardBudgetUsdCents:2}}});
        await expect(guard.reserve(tenantId,price,request)).resolves.toEqual(expect.any(String));
    });
    it('accepts every seeded catalogue feature in the superadmin editor',async()=>{
        const plans=await db.billingPlan.findMany({where:{slug:{in:['emprendedor','starter','pro','enterprise','custom']}}});
        expect(plans).toHaveLength(5);
        for(const plan of plans) expect(validatePlanFeatures(plan.features as any)).toEqual({unknownKeys:[],typeErrors:[]});
    });
    /**
     * El defecto que dejaba mudo a un tenant con dinero sin gastar: cada caída
     * del proveedor y cada salto al siguiente tier dejaba su reserva cobrando
     * el máximo estimado, para siempre.
     */
    it('a provider error settles to the input floor instead of eating the month',async()=>{
        const refused:any=Object.assign(new Error('upstream refused'),{status:500});
        const provider:any={providerName:'test',generate:jest.fn().mockRejectedValue(refused),generateStream:jest.fn()};
        const wrapped=guard.wrap(provider,tenantId,price);
        await expect(wrapped.generate(request)).rejects.toThrow('upstream refused');
        // El precio de entrada de este catálogo es 0, así que el piso es 0 y la
        // siguiente llamada tiene que entrar: no se gastó nada que se pueda mostrar.
        const rows=await db.$queryRawUnsafe(
            `SELECT basis,accounted_micro::text AS accounted FROM public.llm_spend_reservations
             WHERE tenant_id::uuid=$1::uuid AND basis='failed_estimate'`,tenantId) as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0].accounted).toBe('0');
        await expect(wrapped.generate(request)).rejects.toThrow('upstream refused');
        expect(provider.generate).toHaveBeenCalledTimes(2);
    });

    it('sweeps a reservation whose process died, and only once it is old enough',async()=>{
        const month=new Date().toISOString().slice(0,7);
        await db.$executeRawUnsafe(
            `INSERT INTO public.llm_spend_reservations
             (id,tenant_id,month,model,reserved_micro,accounted_micro,basis,created_at)
             VALUES ($1,$2::uuid,$3,'synthetic',9000000,9000000,'reserved_estimate',clock_timestamp())`,
            `huerfana-${tenantId}`,tenantId,month);
        // Recién nacida: una llamada viva no se puede barrer por debajo.
        expect(await guard.sweepStaleReservations(30)).toBe(0);
        await db.$executeRawUnsafe(
            `UPDATE public.llm_spend_reservations SET created_at=clock_timestamp() - interval '2 hours'
             WHERE id=$1`,`huerfana-${tenantId}`);
        expect(await guard.sweepStaleReservations(30)).toBe(1);
        const [row]=await db.$queryRawUnsafe(
            `SELECT basis,accounted_micro::text AS accounted FROM public.llm_spend_reservations WHERE id=$1`,
            `huerfana-${tenantId}`) as any[];
        expect({basis:row.basis,accounted:row.accounted}).toEqual({basis:'failed_estimate',accounted:'0'});
    });

    it('lets the turn through when the spend cannot be measured, instead of silencing every agent',async()=>{
        const broken:any={$transaction:jest.fn().mockRejectedValue(new Error('pgbouncer: no server available'))};
        const unmeasurable=new LlmSpendGuardService(broken as any,
            {get:jest.fn().mockResolvedValue(null)} as any,{runExclusive:jest.fn()} as any);
        const id=await unmeasurable.reserve(tenantId,price,request);
        // No sé el saldo NO es lo mismo que no hay saldo: se deja pasar y se marca.
        expect(id.startsWith('unmetered:')).toBe(true);
    });

    it('two administrators cannot overwrite the same revision',async()=>{
        const plan=await db.billingPlan.findUniqueOrThrow({where:{slug}});
        const controller=new BillingAdminController({} as any,db as any,{invalidatePlanCacheForSlug:async()=>0} as any,{} as any,{} as any,{} as any,{} as any);
        const results=await Promise.allSettled([100,200].map(maxAiMessages=>controller.updatePlan(slug,{expectedUpdatedAt:plan.updatedAt.toISOString(),maxAiMessages},{user:{}})));
        expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
        expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    });
});
