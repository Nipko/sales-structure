import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ensureMissionEvidence } from './mission-evidence';

/** Denominator is inbound turns, not tool calls or a judge's opinion of mission completion. */
export async function missionMetrics(prisma:PrismaService,schema:string,agentId:string,start:string,end:string){
    const from=new Date(start),to=new Date(end);
    if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<=from||to.getTime()-from.getTime()>366*86_400_000)
        throw new BadRequestException({error:'invalid_mission_metrics_range'});
    await ensureMissionEvidence(prisma,schema);
    return prisma.transactionInTenantSchema(schema,async query=>{
        await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`,[`agent-privacy:${schema}`]);
        const base=`WITH eligible AS (
            SELECT m.id,c.id AS conversation_id,c.channel_type,t.message_id AS observed,t.language,t.status,t.profile_id,
                t.agent_version,t.config_hash FROM messages m JOIN conversations c ON c.id=m.conversation_id
            LEFT JOIN agent_mission_turns t ON t.message_id=m.id AND t.source_message_hash=MD5(COALESCE(m.content_text,''))
                AND t.agent_id=$1::uuid AND t.execution_mode='live'
            WHERE m.direction='inbound' AND m.created_at>=$2::timestamptz AND m.created_at<$3::timestamptz
                AND (t.agent_id=$1::uuid OR c.agent_persona_id=$1::uuid)
                AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)
        )`;
        const [total]=await query<any[]>(`${base} SELECT COUNT(*)::int AS eligible_turns,
            COUNT(*) FILTER(WHERE observed IS NOT NULL)::int AS observed_turns,
            COUNT(*) FILTER(WHERE observed IS NULL)::int AS unobserved_turns,
            COUNT(*) FILTER(WHERE observed IS NOT NULL AND status='started')::int AS incomplete_turns,
            COUNT(*) FILTER(WHERE status='failed')::int AS failed_turns FROM eligible`,[agentId,start,end]);
        const groups=await query<any[]>(`${base}, memberships AS (
            SELECT e.*,s.mission_key,MAX(CASE s.difficulty WHEN 'recovery' THEN 3 WHEN 'multi_step' THEN 2 WHEN 'standard' THEN 1 ELSE 0 END) AS difficulty_rank,
                BOOL_OR(s.tool_status='failed') AS tool_failed,BOOL_OR(s.tool_status='succeeded') AS command_succeeded,
                BOOL_OR(s.tool_status='pending') AS pending_command,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.basis),NULL) AS bases
            FROM eligible e LEFT JOIN agent_mission_steps s ON s.message_id=e.observed
                AND s.mission_key IS NOT NULL GROUP BY e.id,e.conversation_id,e.channel_type,e.observed,e.language,e.status,e.profile_id,e.agent_version,e.config_hash,s.mission_key
        ) SELECT COALESCE(mission_key,'unknown') AS mission,COALESCE(language,'unknown') AS language,channel_type AS channel,
            CASE difficulty_rank WHEN 3 THEN 'recovery' WHEN 2 THEN 'multi_step' WHEN 1 THEN 'standard' ELSE 'unknown' END AS difficulty,
            COALESCE(profile_id,'unknown') AS profile_id,agent_version,config_hash,
            COUNT(*)::int AS eligible_turns,COUNT(*) FILTER(WHERE observed IS NOT NULL)::int AS observed_turns,
            COUNT(*) FILTER(WHERE tool_failed)::int AS tool_failure_report_turns,COUNT(*) FILTER(WHERE command_succeeded)::int AS tool_success_report_turns,
            COUNT(*) FILTER(WHERE pending_command)::int AS tool_pending_report_turns,
            COUNT(*)::int AS outcome_unknown_turns,0::int AS verified_success_turns,0::int AS verified_failure_turns
            FROM memberships GROUP BY mission_key,language,channel_type,difficulty_rank,profile_id,agent_version,config_hash
            ORDER BY mission,language,channel,difficulty`,[agentId,start,end]);
        const [instances]=await query<any[]>(`SELECT COUNT(*)::int AS observed_instances,
            COUNT(*) FILTER(WHERE workflow_state='completed')::int AS workflow_completed,
            COUNT(*) FILTER(WHERE workflow_state='paused')::int AS paused,
            COUNT(*) FILTER(WHERE workflow_state='active')::int AS open,
            COUNT(*) FILTER(WHERE workflow_state='cancelled')::int AS cancelled
            FROM agent_mission_instances i WHERE agent_id=$1::uuid AND created_at>=$2::timestamptz AND created_at<$3::timestamptz
                AND NOT EXISTS(SELECT 1 FROM conversations c JOIN customer_memory_erasure e ON e.contact_id=c.contact_id WHERE c.id=i.conversation_id)`,[agentId,start,end]);
        return {version:1,unit:'inbound_turn',groupUnit:'mission_turn_membership',difficultyRubric:'observed_trajectory_v1',
            range:{start,end},...total,instances,groups,operationalSuccessRate:null,
            limitations:['workflow_completion_is_not_verified_outcome','tool_plan_projection_is_not_customer_intent',
                'unobserved_turns_have_unknown_mission_language_and_difficulty','difficulty_measures_observed_trajectory_not_intrinsic_task_difficulty',
                'turns_with_multiple_missions_appear_in_multiple_groups','tool_status_reports_are_not_ledger_or_domain_outcome_proofs',
                'no_abandonment_inferred_from_silence']};
    });
}
