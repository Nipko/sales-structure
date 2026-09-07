import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { buildDomainContractDraft, resolveSubtypeExperienceProfile, TOOL_GROUP_PLAN_FEATURE, VERTICAL_TOOL_GROUPS } from '@parallext/shared';
import { evaluateSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { applyPlanFeatureOverrides } from '../throttle/plan-feature-overrides';
import { validateConfigurationBody, type AgentConfigurationBody, type RevisionQuery } from './agent-configuration-revision';

/** Fresh administrative prerequisites on the publication transaction. No Redis,
 * provider calls, credential decryption, lazy DDL or entitlement fallback.
 * This is not the entire deployment gate: source review, routing ownership and
 * runtime effect fencing are checked by their respective boundaries. */
export async function assertPublicationPrerequisites(query:RevisionQuery,input:{tenantId:string;agentId:string;operational:any;body:AgentConfigurationBody},
    assertConfig:(config:Record<string,any>)=>void):Promise<void>{
    validateConfigurationBody(input.body);assertConfig(input.body.configJson);
    const tenant=(await query<any[]>('SELECT id,plan,industry,settings,is_active,is_internal FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema() FOR SHARE',[input.tenantId]))[0];
    if(!tenant||tenant.is_active!==true)throw new ForbiddenException({error:'agent_publication_tenant_unavailable'});
    const subscription=(await query<any[]>(`SELECT status,trial_ends_at,cancel_at_period_end,current_period_end,cancellation_reason,dunning_started_at
        FROM public.billing_subscriptions WHERE tenant_id=$1::uuid FOR SHARE`,[input.tenantId]))[0];
    const clock=(await query<any[]>('SELECT clock_timestamp()::text AS now'))[0]?.now;
    if(!clock||!Number.isFinite(Date.parse(clock)))throw new Error('agent_publication_clock_unavailable');
    const date=(value:any)=>value==null?null:new Date(value);
    const access=evaluateSubscriptionAccess({isInternal:tenant.is_internal===true,status:subscription?.status||null,
        trialEndsAt:date(subscription?.trial_ends_at),cancelAtPeriodEnd:subscription?.cancel_at_period_end===true,
        currentPeriodEnd:date(subscription?.current_period_end),cancellationReason:subscription?.cancellation_reason||null,
        dunningStartedAt:date(subscription?.dunning_started_at)},'write',new Date(clock));
    if(!access.allowed)throw new ForbiddenException({error:access.error||'agent_publication_subscription_unavailable'});
    const plan=(await query<any[]>('SELECT slug,max_agents,max_ai_messages,features FROM public.billing_plans WHERE slug=$1 FOR SHARE',[tenant.plan]))[0];
    if(!plan)throw new ConflictException({error:'agent_publication_plan_unavailable'});
    const settings=tenant.settings||{},features=applyPlanFeatureOverrides({...plan.features,maxAgents:plan.max_agents,maxAiMessages:plan.max_ai_messages},settings.quotaOverrides||{});
    const limit=features.maxAgents;
    if(!Number.isInteger(limit)||limit< -1)throw new ConflictException({error:'agent_publication_plan_unavailable'});
    if(input.body.isActive){
        const count=(await query<any[]>('SELECT COUNT(*)::int AS total FROM agent_personas WHERE is_active=true AND id<>$1::uuid',[input.agentId]))[0]?.total;
        if(!Number.isInteger(count))throw new Error('agent_publication_capacity_unavailable');
        if(limit!==-1&&count+1>limit)throw new ForbiddenException({error:'agent_limit_reached',currentCount:count,maxAgents:limit});
    }
    const industry=settings.verticalConfig?.industry??tenant.industry??'otro',subType=settings.verticalConfig?.subType??settings.subType??null;
    const profile=resolveSubtypeExperienceProfile(industry,subType),manifest=new Set<string>(profile.capability.toolGroups),scoped=new Set<string>(VERTICAL_TOOL_GROUPS);
    for(const [family,config] of Object.entries(input.body.configJson.tools||{}) as Array<[string,any]>){
        if(config?.enabled!==true)continue;
        if(scoped.has(family)&&!manifest.has(family))throw new BadRequestException({error:'configuration_capability_blocked',family,reasons:['not_in_subtype']});
        const feature=TOOL_GROUP_PLAN_FEATURE[family];
        if(feature&&features[feature]!==true)throw new ForbiddenException({error:'configuration_capability_blocked',family,reasons:['plan_missing_feature']});
    }
    const config=input.body.configJson;
    if((config.editorMode??config._mode)==='prompt'&&features.customPrompt!==true)throw new ForbiddenException({error:'configuration_custom_prompt_unavailable'});
    if(config.mission){
        const allowed=new Set(buildDomainContractDraft(industry,subType).intents.map(intent=>intent.key));
        if(config.mission.intentKeys.some((key:string)=>!allowed.has(key)))throw new BadRequestException({error:'configuration_mission_outside_profile'});
    }
    if(config.tools?.appointments?.enabled===true){
        // Recheck even when the old version already enabled this family: its
        // data may have been removed since the previous review.
        const relations=(await query<any[]>("SELECT to_regclass('services')::text AS services,to_regclass('availability_slots')::text AS slots"))[0];
        if(!relations?.services||!relations?.slots)throw new BadRequestException({error:'appointments_prerequisites_missing'});
        const services=await query<any[]>('SELECT id FROM services WHERE is_active=true FOR SHARE');
        const slots=await query<any[]>('SELECT id FROM availability_slots WHERE is_active=true FOR SHARE');
        if(!services.length||!slots.length)throw new BadRequestException({error:'appointments_prerequisites_missing'});
    }
}
