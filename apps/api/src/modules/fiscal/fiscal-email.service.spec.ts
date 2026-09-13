import { FiscalEmailService } from './fiscal-email.service';

describe('FiscalEmailService durable delivery', () => {
    const invoice:any={id:'11111111-1111-4111-8111-111111111111',tenantId:'22222222-2222-4222-8222-222222222222',
        status:'issued',type:'invoice',provider:'manual',providerRef:'provider-1',cufe:'cufe-1',invoiceNumber:'SET1',
        amountCents:100000,currency:'COP',taxCents:0,relatedInvoiceId:null,metadata:{},
        acquirerSnapshot:{documentId:'123',documentType:'6',businessName:'Cliente',email:'buyer@example.test'},
        issuedAt:new Date('2026-09-01T00:00:00Z'),createdAt:new Date('2026-09-01T00:00:00Z')};
    const cfg={mode:'CO_LOCAL',itemDescription:'Suscripción',coIssuer:{legalName:'Parallly'},factusEnvironment:'sandbox'};

    function build(sendResult:()=>Promise<string>){
        const state:any={delivery:'pending',attempts:0,lease:null,receipt:null};
        const tx={$queryRawUnsafe:jest.fn(async()=>[{...invoice,email_delivery_state:state.delivery,
            email_delivery_attempts:state.attempts,metadata:invoice.metadata}]),
        $executeRawUnsafe:jest.fn(async(sql:string,...params:any[])=>{
            if(sql.includes("email_delivery_state='claimed'")){state.delivery='claimed';state.attempts++;state.lease=params[1];}
            return 1;
        })};
        const prisma:any={
            $transaction:jest.fn(async(work:any)=>work(tx)),
            $queryRawUnsafe:jest.fn(async()=>[]),
            $executeRawUnsafe:jest.fn(async(sql:string,...params:any[])=>{
                if(sql.includes("email_delivery_state='sent'")){state.delivery='sent';state.receipt=params[2];state.lease=null;return 1;}
                if(sql.includes("SET email_delivery_state='sending'")){state.delivery='sending';return 1;}
                if(sql.includes('email_delivery_state=$3')){state.delivery=params[2];state.lease=null;return 1;}
                if(sql.includes("email_delivery_state='suppressed'")){state.delivery='suppressed';state.lease=null;return 1;}
                return 0;
            }),
            fiscalInvoice:{findUnique:jest.fn(async()=>({...invoice}))},
            tenant:{findUnique:jest.fn(async()=>({settings:{}}))},
        };
        const attempt=jest.fn(sendResult);
        const email={prepareBoundedSend:jest.fn(()=>attempt)};
        const service=new FiscalEmailService(prisma,{getConfig:jest.fn(async()=>cfg)} as any,
            {render:jest.fn(async()=>Buffer.from('pdf'))} as any,email as any,
            {read:jest.fn(()=>null),save:jest.fn()} as any,{downloadXml:jest.fn()} as any,
            {runExclusive:jest.fn(async(_k:string,_t:number,work:any)=>work())} as any);
        return {service,state,attempt,email,tx};
    }

    it('stores the SMTP receipt and a second invocation cannot send again',async()=>{
        const h=build(async()=> 'smtp.invoice.1');
        await h.service.sendIssuedInvoice(invoice.id);
        await h.service.sendIssuedInvoice(invoice.id);
        expect(h.attempt).toHaveBeenCalledTimes(1);
        expect(h.state).toMatchObject({delivery:'sent',receipt:'smtp.invoice.1'});
    });

    it('freezes a send whose provider answer was lost',async()=>{
        const h=build(async()=>{throw new Error('smtp_answer_lost');});
        await h.service.sendIssuedInvoice(invoice.id);
        expect(h.state.delivery).toBe('reconciliation_required');
        await h.service.recoverDue();
        expect(h.attempt).toHaveBeenCalledTimes(1);
    });

    it('retries a preparation failure because no provider call began',async()=>{
        const h=build(async()=> 'unused');
        h.email.prepareBoundedSend.mockImplementationOnce(()=>{throw new Error('smtp_not_configured');});
        await h.service.sendIssuedInvoice(invoice.id);
        expect(h.state.delivery).toBe('failed');
        expect(h.attempt).not.toHaveBeenCalled();
    });
});
