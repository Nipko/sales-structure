import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertServedAgentAuthority, type ServedAgentAuthority } from '../persona/served-agent-authority';
import type { PrismaService } from '../prisma/prisma.service';
import { assertOptionalContactId, requireTenantContact } from '../../common/utils/tenant-contact.util';
import { ensureOperationalNoticeOutbox, enqueueOperationalNotice, operationalContactWasErased } from '../operational-notices/operational-notice-outbox';
import type { NoticeQuery } from '../operational-notices/operational-notice.contracts';
import { enrollmentTerms, enrollmentTermsHash, type EnrollmentTerms } from './enrollment-terms';

export interface EnrollmentCommand {
    cohortId: string; contactId?: string; studentName: string; studentEmail?: string; studentPhone?: string;
    allowWaitlist?: boolean; enrollmentTerms?: EnrollmentTerms;
}
const started = (value: unknown) => new Date(value as any).getTime() < new Date(new Date().toISOString().slice(0,10)).getTime();

/** One domain implementation serves dashboard, tools and the isolated evaluation namespace. */
export class EducationEnrollmentCommands {
    constructor(private readonly prisma: PrismaService) {}

    async getTerms(schema: string, cohortId: string): Promise<EnrollmentTerms> {
        const [row] = await this.prisma.executeInTenantSchema<any[]>(schema,
            'SELECT to_jsonb(c) AS course,to_jsonb(co) AS cohort FROM course_cohorts co JOIN courses c ON c.id=co.course_id WHERE co.id=$1::uuid AND c.is_active=true', [cohortId]);
        if (!row) throw new BadRequestException('Course or cohort unavailable');
        return enrollmentTerms(row.course,row.cohort);
    }

    async enroll(schema: string, data: EnrollmentCommand, operationalScope?: ServedAgentAuthority): Promise<any> {
        if (!data.cohortId || !data.studentName) throw new BadRequestException('cohortId and studentName are required');
        const contactId = assertOptionalContactId(data.contactId);
        if (data.allowWaitlist && !contactId) throw new BadRequestException('A contact is required to join the waitlist');
        await ensureOperationalNoticeOutbox(this.prisma,schema);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            await assertServedAgentAuthority(query, schema, operationalScope);
            await requireTenantContact(query,contactId);
            if (await operationalContactWasErased(query,contactId)) throw new BadRequestException('Contact unavailable');
            const [cohort]=await query<any[]>('SELECT * FROM course_cohorts WHERE id=$1::uuid FOR UPDATE',[data.cohortId]);
            if (!cohort || !['open','full'].includes(cohort.status)) throw new BadRequestException('Cohort is not available for enrollment');
            if (started(cohort.starts_at)) throw new BadRequestException('Cohort has already started');
            const [course]=await query<any[]>('SELECT * FROM courses WHERE id=$1::uuid AND is_active=true FOR SHARE',[cohort.course_id]);
            if (!course) throw new BadRequestException('Course is unavailable');
            const terms=enrollmentTerms(course,cohort),hash=enrollmentTermsHash(terms);
            if (data.enrollmentTerms && enrollmentTermsHash(data.enrollmentTerms)!==hash) throw new BadRequestException('enrollment_terms_changed_requires_confirmation');
            const [existing]=contactId ? await query<any[]>("SELECT * FROM enrollments WHERE cohort_id=$1::uuid AND contact_id=$2::uuid AND status IN ('enrolled','active','waitlisted','waitlist_review') ORDER BY created_at,id FOR UPDATE",[data.cohortId,contactId]) : [];
            if (existing && existing.status!=='waitlist_review') return {...existing,idempotentReplay:true,waitlisted:existing.status==='waitlisted',seatAssigned:existing.status!=='waitlisted',charged:false};
            const waiting=Number(cohort.available_seats)<=0;
            if (waiting && !data.allowWaitlist) throw new BadRequestException('cohort_full_waitlist_requires_consent');
            if (!waiting) {
                const claimed=await query<any[]>(`UPDATE course_cohorts SET available_seats=available_seats-1,
                    status=CASE WHEN available_seats-1<=0 THEN 'full' ELSE 'open' END,updated_at=NOW()
                    WHERE id=$1::uuid AND available_seats>0 RETURNING id`,[data.cohortId]);
                if (!claimed[0]) throw new BadRequestException('Cohort is full');
            }
            const metadata={...(existing?.metadata||{}),enrollmentTerms:terms,enrollmentTermsHash:hash,
                waitlistConsent:data.allowWaitlist===true,waitlistJoinedAt:waiting?new Date().toISOString():null};
            delete metadata.waitlistTermsChanged;
            const status=waiting?'waitlisted':'enrolled';
            const [enrollment]=existing ? await query<any[]>(`UPDATE enrollments SET status=$2,metadata=$3::jsonb,
                student_name=$4,student_email=$5,student_phone=$6,updated_at=NOW() WHERE id=$1::uuid RETURNING *`,
                [existing.id,status,JSON.stringify(metadata),data.studentName,data.studentEmail||null,data.studentPhone||null])
                : await query<any[]>(`INSERT INTO enrollments(cohort_id,course_id,contact_id,student_name,student_email,student_phone,status,metadata)
                    VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
                    [data.cohortId,cohort.course_id,contactId,data.studentName,data.studentEmail||null,data.studentPhone||null,status,JSON.stringify(metadata)]);
            return {...enrollment,waitlisted:waiting,seatAssigned:!waiting,charged:false};
        });
    }

    async cancel(schema:string,id:string,input:{contactId?:string;reason?:string}={},operationalScope?:ServedAgentAuthority):Promise<any>{
        await ensureOperationalNoticeOutbox(this.prisma,schema);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            await assertServedAgentAuthority(query, schema, operationalScope);
            const [reference]=await query<any[]>('SELECT cohort_id FROM enrollments WHERE id=$1::uuid',[id]);
            if (!reference) throw new NotFoundException('Enrollment not found');
            // Cohort first is the common lock order for allocation, cancellation and promotion.
            const [cohort]=await query<any[]>('SELECT * FROM course_cohorts WHERE id=$1::uuid FOR UPDATE',[reference.cohort_id]);
            if (!cohort) throw new BadRequestException('Enrollment cohort is missing');
            const [enrollment]=await query<any[]>('SELECT * FROM enrollments WHERE id=$1::uuid FOR UPDATE',[id]);
            if (input.contactId && enrollment.contact_id!==input.contactId) throw new BadRequestException('You can only cancel your own enrollments');
            if (enrollment.status==='dropped') return {success:true,enrollmentId:id,status:'dropped',alreadyCancelled:true,seatReleased:false};
            if (!['enrolled','active','waitlisted','waitlist_review'].includes(enrollment.status)) throw new BadRequestException('Enrollment cannot be cancelled in its current status');
            const seatReleased=['enrolled','active'].includes(enrollment.status);
            await query(`UPDATE enrollments SET status='dropped',notes=CONCAT_WS(E'\n',NULLIF(notes,''),$2::text),updated_at=NOW() WHERE id=$1::uuid`,[id,input.reason?('[Cancelled] '+input.reason):'[Cancelled]']);
            if (seatReleased) {
                const restored=await query<any[]>(`UPDATE course_cohorts SET available_seats=available_seats+1,
                    status=CASE WHEN status='full' THEN 'open' ELSE status END,updated_at=NOW() WHERE id=$1::uuid RETURNING *`,[cohort.id]);
                if (!restored[0]) throw new BadRequestException('Enrollment cohort is missing');
                if (['open','full'].includes(cohort.status)) await this.promote(query,schema,{...cohort,available_seats:Number(cohort.available_seats)+1});
            }
            return {success:true,enrollmentId:id,status:'dropped',seatReleased};
        });
    }

    private async promote(query:NoticeQuery,schema:string,cohort:any):Promise<void>{
        if (started(cohort.starts_at)) return;
        const [course]=await query<any[]>('SELECT * FROM courses WHERE id=$1::uuid AND is_active=true FOR SHARE',[cohort.course_id]);
        if (!course) return;
        const current=enrollmentTerms(course,cohort),hash=enrollmentTermsHash(current);
        const candidates=await query<any[]>("SELECT * FROM enrollments WHERE cohort_id=$1::uuid AND status='waitlisted' ORDER BY created_at,id FOR UPDATE",[cohort.id]);
        for (const candidate of candidates) {
            if (await operationalContactWasErased(query,candidate.contact_id)) {
                await query("UPDATE enrollments SET status='dropped',updated_at=NOW() WHERE id=$1::uuid",[candidate.id]);
                continue;
            }
            if (!candidate.metadata?.waitlistConsent || enrollmentTermsHash(candidate.metadata?.enrollmentTerms)!==hash) {
                await query(`UPDATE enrollments SET status='waitlist_review',metadata=COALESCE(metadata,'{}'::jsonb)||'{"waitlistTermsChanged":true}'::jsonb,updated_at=NOW() WHERE id=$1::uuid`,[candidate.id]);
                await enqueueOperationalNotice(query,schema,{kind:'education.waitlist_review',entityId:candidate.id,contactId:candidate.contact_id,revision:hash!});
                continue;
            }
            await query("UPDATE enrollments SET status='enrolled',enrolled_at=NOW(),metadata=metadata||jsonb_build_object('waitlistPromotedAt',NOW()),updated_at=NOW() WHERE id=$1::uuid",[candidate.id]);
            await query(`UPDATE course_cohorts SET available_seats=available_seats-1,status=CASE WHEN available_seats-1<=0 THEN 'full' ELSE 'open' END,updated_at=NOW() WHERE id=$1::uuid`,[cohort.id]);
            await enqueueOperationalNotice(query,schema,{kind:'education.waitlist_promoted',entityId:candidate.id,contactId:candidate.contact_id});
            return;
        }
    }
}
