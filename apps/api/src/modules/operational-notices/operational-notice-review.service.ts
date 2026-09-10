import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { resolveReadyTenantContext } from '../../common/utils/tenant-lifecycle.util';
import type { NoticeQuery } from './operational-notice.contracts';
import { ensureOperationalNoticeOutbox, operationalContactWasErased } from './operational-notice-outbox';
import { NOTICE_REVIEW_DDL, NOTICE_REVIEW_ROLES, noticeReceiptEvidence, noticeReviewHash, noticeReviewInput, noticeUuid } from './operational-notice-review.contracts';

const states=['pending','queued','processing','sent','stored','failed','suppressed','reconciliation_required'];
const reviewable=['sent','stored','failed','suppressed','reconciliation_required'];
const prepared=new WeakMap<object,Set<string>>();

@Injectable()
export class OperationalNoticeReviewService {
    constructor(private readonly prisma:PrismaService,private readonly redis:RedisService){}

    async list(tenantId:string,filters:{state?:string;conversationId?:string;cursor?:string}={}){
        if((filters.state&&!states.includes(filters.state))||(filters.conversationId&&!noticeUuid(filters.conversationId))
            ||(filters.cursor&&!noticeUuid(filters.cursor)))throw new BadRequestException('notice_filter_invalid');
        const schema=await this.schema(tenantId);await this.ensure(schema);
        return this.transaction(schema,async query=>{
            const params:any[]=[],where:string[]=[];
            if(filters.state){params.push(filters.state);where.push(`n.state=$${params.length}`);}
            if(filters.conversationId){params.push(filters.conversationId);where.push(`n.conversation_id=$${params.length}::uuid`);}
            if(filters.cursor){params.push(filters.cursor);where.push(`(n.created_at,n.id)<(SELECT created_at,id FROM operational_notice_outbox WHERE id=$${params.length}::uuid)`);}
            const rows=await query<any[]>(`SELECT n.*,md5(to_jsonb(n)::text) AS revision FROM operational_notice_outbox n
                ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY n.created_at DESC,n.id DESC LIMIT 101`,params);
            const items=[];
            for(const row of rows.slice(0,100))items.push(await this.present(query,tenantId,row));
            return {items,nextCursor:rows.length>100?rows[99].id:null};
        });
    }

    async detail(tenantId:string,noticeId:string){
        if(!noticeUuid(noticeId))throw new BadRequestException('notice_reference_invalid');
        const schema=await this.schema(tenantId);await this.ensure(schema);
        return this.transaction(schema,async query=>{
            const row=await this.row(query,noticeId);
            const item=await this.present(query,tenantId,row);
            if(!item.contact_id)return {...item,reviews:[]};
            const reviews=await query<any[]>(`SELECT r.id,r.actor_id,r.actor_role,r.action,r.reason,r.human_reference,r.prior_state,r.resulting_state,r.evidence,r.created_at,
                NULLIF(CONCAT_WS(' ',u.first_name,u.last_name),'') AS actor_name
                FROM operational_notice_reviews r LEFT JOIN public.users u ON u.id=r.actor_id
                WHERE r.notice_id=$1::uuid ORDER BY r.created_at DESC,r.id DESC LIMIT 100`,[noticeId]);
            return {...item,reviews};
        });
    }

    async review(tenantId:string,noticeId:string,actorId:string,payload:unknown){
        if(!noticeUuid(noticeId)||!noticeUuid(actorId))throw new BadRequestException('notice_reference_invalid');
        const input=noticeReviewInput(payload),schema=await this.schema(tenantId);await this.ensure(schema);
        return this.transaction(schema,async query=>{
            // JWT guards select the tenant; revalidate the current human role in
            // the transaction before any decision or replay can be acknowledged.
            const actors=await query<any[]>(`SELECT id,role,tenant_id FROM public.users WHERE id=$1::uuid AND is_active=true FOR SHARE`,[actorId]);
            const actor=actors[0];
            if(!actor||!NOTICE_REVIEW_ROLES.includes(actor.role)||(actor.role!=='super_admin'&&actor.tenant_id!==tenantId))throw new ForbiddenException('notice_review_forbidden');
            if(input.action==='suppress'&&!['super_admin','tenant_admin'].includes(actor.role))throw new ForbiddenException('notice_suppression_forbidden');
            if(input.action==='verify'&&actor.role==='tenant_supervisor')throw new ForbiddenException('notice_resolution_forbidden');
            const row=await this.row(query,noticeId,true);
            if(row.error_code==='notice_contact_erased'||!row.contact_id||await operationalContactWasErased(query,row.contact_id))throw new ConflictException('notice_contact_erased');
            const requestHash=noticeReviewHash(input);
            const prior=(await query<any[]>('SELECT id,actor_id,request_hash FROM operational_notice_reviews WHERE notice_id=$1::uuid AND idempotency_key=$2::uuid',[noticeId,input.idempotencyKey]))[0];
            if(prior){
                if(prior.actor_id!==actorId||prior.request_hash!==requestHash)throw new ConflictException('notice_review_idempotency_conflict');
                return {reviewId:prior.id,idempotentReplay:true,notice:await this.present(query,tenantId,row)};
            }
            if(row.revision!==input.expectedRevision)throw new ConflictException('notice_revision_changed');
            if(!reviewable.includes(row.state))throw new ConflictException('notice_processing');
            const evidence=await noticeReceiptEvidence(query,tenantId,row);
            let resultingState=row.state;
            if(input.action==='suppress'){
                if(!['reconciliation_required','failed'].includes(row.state))throw new ConflictException('notice_suppression_unavailable');
                resultingState='suppressed';
            }else if(input.action==='verify'&&['web_stored','web_received'].includes(evidence.status)&&['reconciliation_required','failed'].includes(row.state)){
                // Only reconcile the already committed local message. Never
                // enqueue, publish, acknowledge, or resend it from this endpoint.
                resultingState='stored';
            }
            const reviews=await query<any[]>(`INSERT INTO operational_notice_reviews(notice_id,actor_id,actor_role,action,idempotency_key,
                request_hash,expected_revision,reason,human_reference,prior_state,resulting_state,evidence)
                VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
            [noticeId,actorId,actor.role,input.action,input.idempotencyKey,requestHash,input.expectedRevision,input.reason,input.humanReference||null,row.state,resultingState,JSON.stringify(evidence)]);
            await query(`UPDATE operational_notice_outbox SET state=$2::text,review_revision=review_revision+1,
                error_code=CASE WHEN $3='suppress' THEN 'notice_manually_suppressed' ELSE error_code END,
                completed_at=CASE WHEN state<>$2::text AND $2::text IN ('stored','suppressed') THEN NOW() ELSE completed_at END,
                updated_at=NOW() WHERE id=$1::uuid`,[noticeId,resultingState,input.action]);
            return {reviewId:reviews[0].id,idempotentReplay:false,notice:await this.present(query,tenantId,await this.row(query,noticeId))};
        });
    }

    private async present(query:NoticeQuery,tenantId:string,row:any){
        const erased=row.error_code==='notice_contact_erased'||!!row.contact_id&&await operationalContactWasErased(query,row.contact_id);
        const contact=!erased&&row.contact_id?(await query<any[]>('SELECT name FROM contacts WHERE id=$1::uuid',[row.contact_id]))[0]:null;
        const latestReview=(await query<any[]>(`SELECT id,actor_role,action,reason,human_reference,resulting_state,evidence,created_at
            FROM operational_notice_reviews WHERE notice_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 1`,[row.id]))[0]||null;
        return {id:row.id,kind:row.kind,entity_id:erased?null:row.entity_id,contact_id:erased?null:row.contact_id,
            contact_name:contact?.name||null,conversation_id:erased?null:row.conversation_id,state:row.state,route:row.route,
            provider_reference:erased?null:row.provider_reference,attempts:row.attempts,error_code:row.error_code,
            created_at:row.created_at,updated_at:row.updated_at,completed_at:row.completed_at,revision:row.revision,
            verification:await noticeReceiptEvidence(query,tenantId,erased?{...row,contact_id:null}:row),
            latestReview:erased?null:latestReview,reviewable:!erased&&!!row.contact_id&&reviewable.includes(row.state)};
    }
    private async row(query:NoticeQuery,id:string,lock=false){
        const row=(await query<any[]>(`SELECT n.*,md5(to_jsonb(n)::text) AS revision FROM operational_notice_outbox n WHERE id=$1::uuid ${lock?'FOR UPDATE':''}`,[id]))[0];
        if(!row)throw new NotFoundException('notice_not_found');return row;
    }
    private async ensure(schema:string){
        await ensureOperationalNoticeOutbox(this.prisma,schema);
        if(prepared.get(this.prisma)?.has(schema))return;
        await this.prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`${schema}:operational-notice-review-schema`]);
            await query('ALTER TABLE operational_notice_outbox ADD COLUMN IF NOT EXISTS review_revision INTEGER NOT NULL DEFAULT 0');
            await query(NOTICE_REVIEW_DDL);
        });
        const schemas=prepared.get(this.prisma)||new Set<string>();schemas.add(schema);prepared.set(this.prisma,schemas);
    }
    private transaction<T>(schema:string,work:(query:NoticeQuery)=>Promise<T>):Promise<T>{
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            return work(query);
        });
    }
    private async schema(tenantId:string){
        if(!noticeUuid(tenantId))throw new BadRequestException('notice_tenant_invalid');
        const tenant=await resolveReadyTenantContext(this.prisma,this.redis,tenantId);
        if(!tenant||!/^tenant_[a-z0-9_]+$/.test(tenant.schemaName)||tenant.schemaName.startsWith('tenant_eval_'))throw new ConflictException('notice_tenant_unavailable');
        return tenant.schemaName;
    }
}
