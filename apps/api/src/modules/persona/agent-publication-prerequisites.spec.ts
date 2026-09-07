import { assertPublicationPrerequisites } from './agent-publication-prerequisites';
import type { RevisionQuery } from './agent-configuration-revision';

describe('publication uses current transaction prerequisites',()=>{
    function fixture(){
        const tenant:any={id:'tenant',plan:'current',industry:'education',settings:{verticalConfig:{industry:'education',subType:'capacitacion'}},is_active:true,is_internal:false};
        const subscription:any={status:'active',cancel_at_period_end:false};
        const plan:any={slug:'current',max_agents:2,max_ai_messages:100,features:{customerPayments:true,customPrompt:true}};
        const state={tenant,subscription,plan,count:1,services:[{id:'service'}],slots:[{id:'slot'}]};
        const query=jest.fn(async(sql:string)=>{
            if(sql.includes('FROM public.tenants'))return state.tenant?[state.tenant]:[];
            if(sql.includes('FROM public.billing_subscriptions'))return state.subscription?[state.subscription]:[];
            if(sql.includes('clock_timestamp'))return [{now:'2026-09-07T17:00:00Z'}];
            if(sql.includes('FROM public.billing_plans'))return state.plan?[state.plan]:[];
            if(sql.includes('COUNT(*)'))return [{total:state.count}];
            if(sql.includes('to_regclass'))return [{services:'services',slots:'availability_slots'}];
            if(sql.includes('FROM services'))return state.services;
            if(sql.includes('FROM availability_slots'))return state.slots;
            throw new Error('unexpected query');
        });
        const input={tenantId:'tenant',agentId:'agent',operational:{config_json:{tools:{appointments:{enabled:true}}}},body:{name:'Alex',configJson:{persona:{name:'Alex'},tools:{payments:{enabled:true}}} as any,
            channels:['web_widget'],channelBindings:['web_widget:owned'],isActive:true,isDefault:true,scheduleMode:'24_7'}};
        const validate=jest.fn();const run=()=>assertPublicationPrerequisites(query as RevisionQuery,input,validate);
        return {state,query,input,validate,run};
    }
    it('reads the selected runtime plan and reuses only registered numeric overrides on the same query',async()=>{
        const {state,query,input,run}=fixture();state.count=3;state.tenant.settings.quotaOverrides={maxAgents:4,customerPayments:false,unreviewed:true};
        await run();expect(query.mock.calls.some(([sql])=>sql.includes('billing_plans')&&sql.includes('FOR SHARE'))).toBe(true);
        state.tenant.settings.quotaOverrides.maxAgents=3;await expect(run()).rejects.toMatchObject({response:{error:'agent_limit_reached'}});
        input.body.isActive=false;await run();
    });
    it.each(['pending_auth','expired','paused'])('refuses %s despite a valid plan',async status=>{
        const {state,run}=fixture();state.subscription.status=status;await expect(run()).rejects.toBeDefined();
    });
    it('refuses missing subscription, expired trial and elapsed paid period at database time',async()=>{
        const {state,run}=fixture();state.subscription=null;await expect(run()).rejects.toMatchObject({response:{error:'subscription_status_unavailable'}});
        state.subscription={status:'trialing',trial_ends_at:'2026-01-01T00:00:00Z'};await expect(run()).rejects.toBeDefined();
        state.subscription={status:'active',cancel_at_period_end:true,current_period_end:'2026-09-07T17:00:00Z'};
        await expect(run()).rejects.toMatchObject({response:{error:'subscription_expired'}});
    });
    it('honors explicit internal tenants but still refuses inactive tenants and missing plans',async()=>{
        const {state,run}=fixture();state.subscription=null;state.tenant.is_internal=true;await run();
        state.tenant.is_active=false;await expect(run()).rejects.toMatchObject({response:{error:'agent_publication_tenant_unavailable'}});
        state.tenant.is_active=true;state.plan=null;await expect(run()).rejects.toMatchObject({response:{error:'agent_publication_plan_unavailable'}});
    });
    it('revalidates feature and custom-prompt eligibility without any cached allowance',async()=>{
        const {state,input,run}=fixture();await run();state.plan.features.customerPayments=false;
        await expect(run()).rejects.toMatchObject({response:{error:'configuration_capability_blocked',reasons:['plan_missing_feature']}});
        input.body.configJson.tools={};input.body.configJson.editorMode='prompt';state.plan.features.customPrompt=false;
        await expect(run()).rejects.toMatchObject({response:{error:'configuration_custom_prompt_unavailable'}});
    });
    it('rejects families and missions outside the current business profile',async()=>{
        const {input,run}=fixture();input.body.configJson.tools={properties:{enabled:true}};
        await expect(run()).rejects.toMatchObject({response:{error:'configuration_capability_blocked',reasons:['not_in_subtype']}});
        input.body.configJson.tools={};input.body.configJson.mission={intentKeys:['invented_intent']};
        await expect(run()).rejects.toMatchObject({response:{error:'configuration_mission_outside_profile'}});
    });
    it('checks required appointment data even when appointments were already enabled',async()=>{
        const {state,input,query,run}=fixture();input.body.configJson.tools={appointments:{enabled:true}};
        await run();expect(query.mock.calls.some(([sql])=>sql.includes('availability_slots WHERE is_active=true FOR SHARE'))).toBe(true);
        state.slots=[];await expect(run()).rejects.toMatchObject({response:{error:'appointments_prerequisites_missing'}});
    });
    it('propagates unreadable dependencies and the canonical configuration validator without allowing publication',async()=>{
        const {query,validate,run}=fixture();query.mockRejectedValueOnce(new Error('db unavailable'));
        await expect(run()).rejects.toThrow('db unavailable');validate.mockImplementation(()=>{throw new Error('invalid persona');});
        await expect(run()).rejects.toThrow('invalid persona');
    });
});
