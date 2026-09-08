import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { appointmentServiceTerms, AppointmentTermsChangedError } from '../appointments/appointment-service-terms';
import { EducationService } from '../education/education.service';
import { GymsService } from '../gyms/gyms.service';
import { PetsService } from '../pets/pets.service';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { authorityFor } from '../conversations/__fixtures__/tool-authority.fixture';
import { ToolExecutionControlService } from '../conversations/tool-execution-control.service';
import { ToolApprovalWorkflowService } from '../conversations/tool-approval-workflow.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { IsolatedEvalNamespace, isolatedEvalNamespaceForPrisma } from './isolated-eval-namespace';
import { EvalService, EVAL_EFFECT_VERIFIERS } from './eval.service';
import { verifyExpectedEffects } from './eval-effect-verifier';
import { tenantActorDirectoryWithQuery } from '../appointments/tenant-user-scope.util';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { hasEvalIdentityFixture } from './eval-identity-fixture';
import { PAYMENT_REFERENCE_TARGETS } from '../tenant-payments/tenant-payment-reference';
import { MissionFocusStore } from '../conversations/mission-focus-store';
import { arbitrateMissionFocus } from '../conversations/mission-focus';
import type { MissionExecutionScopeV1 } from '@parallext/shared';
import { agentTurnFixture, publishTools } from '../conversations/__fixtures__/agent-turn.fixture';
import { AgentTurnTrace, EphemeralTurnState, type AgentTurnSession } from '../conversations/agent-turn-session';
import { persistConversationRuntimeState } from '../conversations/conversation-runtime-state';
import { captureLearningLedger, verifyLearningOperation } from '../learning/learning-operation-evidence';
import { evaluationNamespaceTimezone } from './eval-temporal-context';
import { prepareCanonicalEvalFixtures } from './eval-canonical-fixtures';
import { PrismaClient } from '@prisma/client';
import { RegionalProfileService } from '../tenants/regional-profile.service';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('canonical domain commands in a disposable PostgreSQL namespace', () => {
    let pool: any, prisma: any, namespaces: IsolatedEvalNamespace, lease: any;
    let appointments: AppointmentsService, gyms: GymsService, education: EducationService, executor: AIToolExecutorService;
    const tenantId = randomUUID(), source = `tenant_commands_${randomUUID().replace(/-/g, '')}`;
    const contactId = '00000000-0000-4000-8000-00000000eba1', otherContact = randomUUID();
    const serviceId = randomUUID(), classId = randomUUID(), memberId = randomUUID(), otherMember = randomUUID(), courseId = randomUUID(), cohortId = randomUUID();
    let conversationId: string;
    const effects = { emit: jest.fn(() => { throw new Error('outbound_domain_event_forbidden'); }) };
    const calendar = { enqueueWithQuery: jest.fn(() => { throw new Error('calendar_outbox_forbidden'); }) };
    const identityBoundary = {
        isVerified: jest.fn(() => { throw new Error('live_identity_read_forbidden'); }),
        startVerification: jest.fn(() => { throw new Error('live_identity_otp_forbidden'); }),
    };
    const tables = ['customer_memory_erasure','customer_profiles','contact_identities','contacts','conversations','messages','persona_config','agent_personas','courses','campaigns','companies','leads','opportunities',
        'pipelines','pipeline_stages','deals','services','service_staff','calendar_integrations','appointments','availability_slots','blocked_dates',
        'membership_plans','members','fitness_classes','class_bookings','course_cohorts','enrollments',
        'properties','property_bookings','tour_packages','tour_inventory','tour_bookings','menu_items','food_orders','food_order_items',
        'products','orders','order_items','stock_movements','vehicles','pets','pet_vaccinations','pet_command_receipts','insurance_policies','insurance_claims',
        'staff_members','customer_vehicles','repair_orders','repair_order_events'];
    const date = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0,10);
    const query = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows;
    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/parallly_eval_isolation')) throw new Error('disposable_eval_database_required');
        pool = new (require('pg').Pool)({ connectionString: connection });
        prisma = {
            $queryRawUnsafe: (sql: string,...params: any[]) => query(sql,params),
            $executeRawUnsafe: (sql: string,...params: any[]) => query(sql,params),
            $transaction: async (work: any) => {
                const client = await pool.connect();
                await client.query('BEGIN');
                const q = async (sql: string,...params: any[]) => (await client.query(sql,params)).rows;
                try { const result = await work({ $queryRawUnsafe:q,$executeRawUnsafe:q }); await client.query('COMMIT'); return result; }
                catch(error) { await client.query('ROLLBACK'); throw error; }
                finally { client.release(); }
            },
            transactionInTenantSchema: (schema: string, work: any) => prisma.$transaction(async (tx: any) => {
                if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error('bad_schema');
                await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
                return work((sql: string,params: any[] = [])=>tx.$queryRawUnsafe(sql,...params));
            }),
            executeInTenantSchema: (schema: string,sql: string,params: any[] = []) => prisma.transactionInTenantSchema(schema,(q: any)=>q(sql,params)),
            assertTenantSchemaName: (schema: string) => { if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error('bad_schema'); },
            getTenantSchemaName: async()=>source,
        };
        await query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await query('CREATE TABLE IF NOT EXISTS public.tenants (id uuid PRIMARY KEY,schema_name text NOT NULL)');
        await query('ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true');
        await query('CREATE TABLE IF NOT EXISTS public.users (id uuid PRIMARY KEY,tenant_id uuid,is_active boolean,first_name text,last_name text)');
        await query('INSERT INTO public.tenants(id,schema_name) VALUES($1,$2)',[tenantId,source]);
        await query(`CREATE SCHEMA "${source}"`);
        // Use the checked-in domain DDL, including its later column migrations.
        // No miniature test-only substitute for the actual command schema.
        const sql = readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8').replace(/\{\{SCHEMA_NAME\}\}/g,source);
        const statements: string[] = (PrismaService.prototype as any).splitSqlStatements(sql);
        for (const statement of statements) {
            const match = statement.match(/^(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+"[^"]+"\."([a-z_]+)"/i);
            if ((match && tables.includes(match[1])) || statement.startsWith('DO $payment_policy_columns$')) await query(statement);
        }
        namespaces = isolatedEvalNamespaceForPrisma(prisma);
        appointments = new AppointmentsService(prisma,effects as any,calendar as any,{ timezoneForSchema: async()=> 'America/Bogota' } as any);
        gyms = new GymsService(prisma); education = new EducationService(prisma);
        const slots = { acquireLockToken:async()=>randomUUID(),releaseLockToken:async()=>true,get:async()=>null,incr:async()=>1,expire:async()=>true };
        const control = new ToolExecutionControlService(prisma,{ get:()=> 'isolated-test-secret-length-32-characters' } as any,identityBoundary as any,slots as any);
        const args: any[] = Array(32).fill({});
        Object.assign(args,{0:prisma,1:slots,2:effects,11:new PetsService(prisma),13:gyms,14:education,21:control,22:{},31:appointments});
        executor = new (AIToolExecutorService as any)(...args);
    },30000);
    beforeEach(async () => {
        lease = await namespaces.provision(tenantId,source,tables);
        const q = (sql: string,params: any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        await q("INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'eval','web_widget','Eval'),($2::uuid,'other','web_widget','Other')",[contactId,otherContact]);
        conversationId=(await q("INSERT INTO conversations(contact_id,channel_type,channel_account_id) VALUES($1::uuid,'web_widget','eval') RETURNING id",[contactId]))[0].id;
        await q("INSERT INTO persona_config(config_yaml,config_json,is_active) VALUES('{}',$1::jsonb,true)",[JSON.stringify({hours:{timezone:'America/Bogota'}})]);
        await q("INSERT INTO services(id,name,duration_minutes,max_concurrent,price,currency,payment_policy,deposit_percent) VALUES($1::uuid,'Service',30,1,100,'COP','none',NULL)",[serviceId]);
        await q("INSERT INTO courses(id,name,slug) VALUES($1::uuid,'Course','course')",[courseId]);
        await q("INSERT INTO course_cohorts(id,course_id,cohort_code,starts_at,max_capacity,available_seats,status) VALUES($1::uuid,$2::uuid,'COHORT',$3::date,1,1,'open')",[cohortId,courseId,date]);
        await q("INSERT INTO members(id,contact_id,status,class_credits_remaining) VALUES($1::uuid,$2::uuid,'active',2),($3::uuid,$4::uuid,'active',2)",[memberId,contactId,otherMember,otherContact]);
        await q("INSERT INTO fitness_classes(id,name,scheduled_at,max_capacity,available_spots,credits_required) VALUES($1::uuid,'Class',$2::timestamp,1,1,1)",[classId,`${date} 10:00`]);
    },30000);
    afterEach(async () => { if(lease) await namespaces.dispose(lease); lease=undefined; });
    afterAll(async () => {
        if(!pool) return;
        await query(`DROP TABLE ${(await query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[source])).map((r: any)=>`"${source}"."${r.tablename}"`).join(',')} RESTRICT`);
        await query(`DROP SCHEMA "${source}" RESTRICT`);
        await query('DELETE FROM public.tenants WHERE id=$1',[tenantId]);
        await pool.end();
    });
    const create = (time='10:00') => appointments.create(lease.schemaName,{contactId,conversationId,serviceId,serviceName:'Service',
        startAt:`${date}T${time}:00`,endAt:`${date}T${time.slice(0,2)}:30:00`,metadata:{source:'eval_gate'},customerName:'Eval'}, {suppressEffects:true,confirmWithoutPayment:true,sandboxNamespace:lease});
    it('uses the owned namespace timezone even when direct creation supplies a conflicting metadata zone', async () => {
        const q = (sql: string, params: any[] = []) => prisma.executeInTenantSchema(lease.schemaName, sql, params);
        await q("UPDATE persona_config SET config_json=jsonb_set(config_json,'{hours,timezone}','\"Europe/Paris\"'::jsonb)");
        const result = await appointments.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service',
            startAt: '2027-03-28T02:15:00', endAt: '2027-03-28T02:45:00', metadata: { timezone: 'America/Bogota' } },
            { sandboxNamespace: lease }).then(() => null, error => error.getResponse?.() || error.message);
        expect(result).toMatchObject({ error: 'nonexistent_local_time', timezone: 'Europe/Paris' });
        expect(Number((await q('SELECT COUNT(*) AS count FROM appointments'))[0].count)).toBe(0);
        const valid = await appointments.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service',
            startAt: '2027-03-29T10:00:00', endAt: '2027-03-29T10:30:00', metadata: { timezone: 'America/Bogota' } },
            { sandboxNamespace: lease, confirmWithoutPayment: true });
        expect(valid.metadata?.timezone).toBe('Europe/Paris');
    });
    it.each(['missing', 'duplicate', 'invalid', 'expired', 'foreign'])
    ('rejects %s evaluation timezone authority without substituting a live default', async state => {
        const q = (sql: string, params: any[] = []) => prisma.executeInTenantSchema(lease.schemaName, sql, params);
        if (state === 'missing') await q("UPDATE persona_config SET config_json='{}'::jsonb");
        if (state === 'duplicate') await q("INSERT INTO persona_config(config_yaml,config_json,is_active) VALUES('{}',$1::jsonb,true)", [JSON.stringify({ hours: { timezone: 'UTC' } })]);
        if (state === 'invalid') await q("UPDATE persona_config SET config_json=jsonb_set(config_json,'{hours,timezone}','\"Etc/Broken\"'::jsonb)");
        if (state === 'expired') await q("UPDATE __eval_namespace SET expires_at=clock_timestamp()-interval '1 second'");
        await expect(evaluationNamespaceTimezone(prisma, lease.schemaName, state === 'foreign' ? { ...lease, token: randomUUID() } : lease))
            .rejects.toThrow(state === 'invalid' ? 'eval_timezone_invalid' : ['foreign', 'expired'].includes(state) ? 'eval_namespace_lease_lost' : 'eval_timezone_unavailable');
        expect(Number((await q('SELECT COUNT(*) AS count FROM appointments'))[0].count)).toBe(0);
    });
    it('seeds captured scheduling facts and creates a canonical appointment through real Prisma without regional lookup', async () => {
        const client = new PrismaClient({ datasourceUrl: connection });
        try {
            const actual = Object.assign(Object.create(PrismaService.prototype), { tenant: client.tenant,
                $transaction: client.$transaction.bind(client), $queryRawUnsafe: client.$queryRawUnsafe.bind(client),
                $executeRawUnsafe: client.$executeRawUnsafe.bind(client) }) as PrismaService;
            const q = (sql: string, params: any[] = []) => actual.executeInTenantSchema<any[]>(lease.schemaName, sql, params);
            await q('DELETE FROM persona_config');
            const capture = { capturedAt: new Date().toISOString(), config: { hours: { timezone: 'America/Bogota', schedule: {} } },
                contextInputs: { businessHours: { timezone: 'Pacific/Auckland', schedule: {
                    tuesday: { enabled: true, open: '13:15', close: '14:15' },
                } } } };
            const fixture = await prepareCanonicalEvalFixtures(q, lease.schemaName, capture as any);
            expect(fixture.status).toBe('ready');
            if (fixture.status !== 'ready') throw new Error('fixture_blocked');
            const regional = new RegionalProfileService(actual, {} as any);
            const liveLookup = jest.spyOn(regional, 'timezoneForSchema').mockRejectedValue(new Error('live_region_forbidden'));
            const command = new AppointmentsService(actual, effects as any, calendar as any, regional);
            const created = await command.create(lease.schemaName, { contactId, conversationId,
                assignedTo: fixture.ids.staffUser, serviceId: fixture.ids.service, serviceName: fixture.bindings.service,
                startAt: `${fixture.date}T${fixture.time}:00`, endAt: `${fixture.date}T${fixture.endTime}:00` },
                { sandboxNamespace: lease, confirmWithoutPayment: true });
            expect(created.metadata?.timezone).toBe('Pacific/Auckland');
            expect(created.status).toBe('confirmed');
            expect((await q("SELECT to_char(start_at,'HH24:MI') AS time FROM appointments WHERE id=$1::uuid", [created.id]))[0].time).toBe('13:15');
            expect(liveLookup).not.toHaveBeenCalled();
        } finally { await client.$disconnect(); }
    });
    it.each(['Sí, confirmo la corrección.', 'Yes, I confirm the correction.', 'Sim, confirmo a correção.', 'Oui, je confirme la correction.'])
    ('registers, replays, reads and corrects a pet through its owned namespace: %s', async confirmation => {
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const invoke=(name:string,args:any)=>executor.execute(lease.schemaName,tenantId,contactId,name,args,conversationId,{
            authority:authorityFor(name),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        await inbound('Registra a Luna, mi gata, con peso de cuatro kilos.');
        expect((await invoke('list_pets_for_contact',{})).pets).toEqual([]);
        const evidenceScope={tenantId,contactId,conversationId,namespace:lease,assertLease:()=>namespaces.assertOwned(lease)};
        const beforeCreate=await captureLearningLedger(prisma,evidenceScope);
        const created=await invoke('register_pet',{name:'Luna',species:'cat',weightKg:4});
        expect(created.error).toBeUndefined();expect(created.species).toBe('cat');
        expect(await verifyLearningOperation(prisma,evidenceScope,{name:'register_pet',result:created},beforeCreate))
            .toMatchObject({status:'verified',effect:'committed',table:'pets'});
        const beforeReplay=await captureLearningLedger(prisma,evidenceScope);
        const replay=await invoke('register_pet',{name:'Luna',species:'cat',weightKg:4});
        expect(replay.petId).toBe(created.petId);
        expect(await verifyLearningOperation(prisma,evidenceScope,{name:'register_pet',result:replay},beforeReplay))
            .toMatchObject({status:'verified',effect:'replayed'});
        expect((await invoke('list_pets_for_contact',{})).pets[0].id).toBe(created.petId);
        await inbound('Corrige el peso de Luna a 4.5 kilos.');
        const args={petId:created.petId,weightKg:4.5};
        const challenge=await invoke('update_pet',args);expect(challenge.error).toBe('confirmation_required');
        expect(Number((await q('SELECT weight_kg FROM pets WHERE id=$1::uuid',[created.petId]))[0].weight_kg)).toBe(4);
        await inbound('Sí, confirmo la corrección, pero primero cambia el peso a 8 kilos.');
        expect((await invoke('update_pet',{...args,_control:{confirmationToken:challenge.confirmationToken}})).error).toBe('confirmation_required');
        expect(Number((await q('SELECT weight_kg FROM pets WHERE id=$1::uuid',[created.petId]))[0].weight_kg)).toBe(4);
        await inbound(confirmation);
        const beforeUpdate=await captureLearningLedger(prisma,evidenceScope);
        const updated=await invoke('update_pet',{...args,_control:{confirmationToken:challenge.confirmationToken}});
        expect(updated.error).toBeUndefined();expect(updated.success).toBe(true);
        expect(await verifyLearningOperation(prisma,evidenceScope,{name:'update_pet',result:updated},beforeUpdate))
            .toMatchObject({status:'verified',effect:'committed',table:'pets'});
        expect((await verifyExpectedEffects({expected:[{kind:'db_effect',type:'row_count',table:'pets',family:'pets',count:1},
            {kind:'db_effect',type:'row_exists',table:'pets',family:'pets',where:{name:'Luna',species:'cat',weight_kg:4.5}}],
            contactId,verifiers:EVAL_EFFECT_VERIFIERS,query:q})).passed).toBe(true);
        await q('UPDATE pets SET weight_kg=8 WHERE id=$1::uuid',[created.petId]);
        expect(await verifyLearningOperation(prisma,evidenceScope,{name:'update_pet',result:updated},beforeUpdate))
            .toMatchObject({status:'unverified',reason:'pet_record_mismatch'});
        await q('UPDATE pets SET weight_kg=4.5 WHERE id=$1::uuid',[created.petId]);
        await q("DELETE FROM pet_command_receipts WHERE pet_id=$1::uuid AND command_kind='update'",[created.petId]);
        expect(await verifyLearningOperation(prisma,evidenceScope,{name:'update_pet',result:updated},beforeUpdate))
            .toMatchObject({status:'unverified',reason:'pet_receipt_missing'});
        expect(effects.emit).not.toHaveBeenCalled();expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
        expect(identityBoundary.startVerification).not.toHaveBeenCalled();
        expect(await query(`SELECT id FROM "${source}".pets`)).toEqual([]);
        expect(await query(`SELECT command_key FROM "${source}".pet_command_receipts`)).toEqual([]);
    });
    it.each([
        ['es', 'Quiero matricularme', 'Ahora quiero agendar una cita', 'Sí, confirmo'],
        ['en', 'I want to enroll', 'Now I want to book an appointment', 'Yes, I confirm'],
        ['pt', 'Quero me inscrever', 'Agora quero agendar uma consulta', 'Sim, confirmo'],
        ['fr', 'Je veux une inscription', 'Maintenant je veux prendre rendez-vous', 'Oui, je confirme'],
    ])('%s binds consent to the active mission and requires a later answer after resume', async (_language, request, switchTask, yes) => {
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const inbound=async(text:string)=>(await q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp()) RETURNING id",[conversationId,text]))[0].id;
        const scope: MissionExecutionScopeV1 = { version:1, kind:'tool', executionOwner:'tool', missionId:randomUUID(), revision:1, inboundMessageId:await inbound(request), expectedReply:null };
        const invoke=()=>executor.execute(lease.schemaName,tenantId,contactId,'enroll_student',{cohortId,studentName:'Eval'},conversationId,{
            authority:authorityFor('enroll_student'),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,missionScope:structuredClone(scope),
        });
        const challenge=await invoke();expect(challenge.error).toBe('confirmation_required');
        const store=new MissionFocusStore(prisma,lease.schemaName,conversationId,contactId);
        const state=await store.load();state.revision=scope.revision;state.selected={id:scope.missionId,kind:'tool',domain:'education',toolName:'enroll_student',reference:challenge.confirmationId};
        state.expectedReply={missionId:scope.missionId,proposalId:challenge.confirmationId,ledgerId:challenge.confirmationId,sourceMessageId:scope.inboundMessageId,kind:'confirmation'};
        await store.save(state);
        const switched=arbitrateMissionFocus({state,candidates:[],text:switchTask,messageId:await inbound(switchTask)}).state;
        await store.save(switched);
        // Reconstruct the store to prove PG, rather than process memory, owns focus.
        const restored=await new MissionFocusStore(prisma,lease.schemaName,conversationId,contactId).load();
        expect(restored.expectedReply).toBeNull();expect(restored.pausedTools).toHaveLength(1);
        scope.missionId=restored.selected!.id;scope.revision=restored.revision;scope.expectedReply=null;scope.kind='booking';scope.domain='appointment';
        scope.inboundMessageId=await inbound(yes);
        expect((await invoke()).error).toBe('mission_selection_required');
        expect((await invoke()).error).toBe('mission_selection_required');
        expect((await q('SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(0);
        const resumed=arbitrateMissionFocus({state:restored,candidates:[],text:'retomar la matricula',messageId:await inbound('retomar la matricula')}).state;
        await store.save(resumed);scope.missionId=resumed.selected!.id;scope.revision=resumed.revision;scope.kind='tool';scope.domain='education';
        scope.inboundMessageId=(await q("SELECT id FROM messages ORDER BY created_at DESC LIMIT 1"))[0].id;
        const fresh=await invoke();expect(fresh.error).toBe('confirmation_required');
        scope.expectedReply={missionId:scope.missionId,proposalId:fresh.confirmationId,ledgerId:fresh.confirmationId,sourceMessageId:scope.inboundMessageId,kind:'confirmation'};
        expect((await invoke()).error).toBe('confirmation_required');
        scope.inboundMessageId=await inbound(yes);
        expect((await invoke()).error).toBeUndefined();
        expect((await invoke()).error).toBeUndefined();
        expect((await q('SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(1);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".enrollments`))[0].n).toBe(0);
    });

    it.each([
        ['es','Quiero matricularme en un curso','Sí, confirmo'], ['en','I want to enroll in a course','Yes, I confirm'],
        ['pt','Quero uma inscricao no curso','Sim, confirmo'], ['fr','Je veux une inscription au cours','Oui, je confirme'],
    ])('%s runs the real core and cannot use one inbound for education and gym or replay it',async(language,request,yes)=>{
        const f=agentTurnFixture({toolExecutor:executor});
        f.personaService.getAgent.mockResolvedValue({version:1,config_json:{language,industry:'retail',tools:{},rag:{enabled:false},llm:{}}});
        publishTools(f,['enroll_student','book_class']);
        const snapshot=await f.service.captureSnapshot(tenantId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const session:AgentTurnSession={id:randomUUID(),tenantId,agentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',channelType:'telegram',contactId,conversationId,schemaName:lease.schemaName,
            snapshot,sandboxNamespace:lease,mode:'sandbox',executionContext:AGENT_TEST_EXECUTION_CONTEXT,state:new EphemeralTurnState(),metadata:{},history:[],lastMessageAt:new Date().toISOString(),trace:new AgentTurnTrace()};
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const writer=(name:string,args:any)=>({id:randomUUID(),function:{name,arguments:JSON.stringify(args)}});
        const run=async(text:string,replayId?:string)=>{
            const id=replayId||(await q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp()) RETURNING id",[conversationId,text]))[0].id;
            session.trace=new AgentTurnTrace();
            await f.runtime.executeAgentTurn({id,tenantId,channelType:'telegram',contactId,content:{type:'text',text},timestamp:new Date()} as any,session);
            expect(session.trace.error).toBeUndefined();return id;
        };
        const calls=[writer('enroll_student',{cohortId,studentName:'Eval'}),writer('book_class',{classId})];
        f.llmRouter.execute.mockResolvedValueOnce({content:'',toolCalls:calls});
        await run(request);
        expect(session.trace.toolCalls).toEqual(expect.arrayContaining([expect.objectContaining({name:'book_class',result:expect.objectContaining({error:'mission_selection_required'})})]));
        expect(session.metadata.missionFocus.expectedReply).toMatchObject({kind:'confirmation'});
        expect((await q('SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(0);
        f.llmRouter.execute.mockResolvedValueOnce({content:'',toolCalls:calls});
        const yesId=await run(yes);
        expect((await q('SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(1);
        expect((await q('SELECT count(*)::int AS n FROM class_bookings'))[0].n).toBe(0);
        expect(session.metadata.missionFocus.lastConsumed.messageId).toBe(yesId);
        const before=structuredClone(session.metadata.missionFocus);
        f.llmRouter.execute.mockResolvedValueOnce({content:'',toolCalls:[writer('book_class',{classId})]});
        await run(yes,yesId);
        expect(session.metadata.missionFocus.selected).toEqual(before.selected);
        expect(session.metadata.missionFocus.lastConsumed).toEqual(before.lastConsumed);
        expect((await q('SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(1);
        expect((await q('SELECT count(*)::int AS n FROM class_bookings'))[0].n).toBe(0);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".enrollments`))[0].n).toBe(0);
    });

    it.each([
        ['es','Quiero una matricula','Sí, confirmo'],['en','I want an enrollment','Yes, I confirm'],
        ['pt','Quero uma inscricao','Sim, confirmo'],['fr','Je veux une inscription','Oui, je confirme'],
    ])('%s completes the selected procedure through its own command port and preserves execution evidence',async(language,request,yes)=>{
        const f=agentTurnFixture({toolExecutor:executor}),procedureId=randomUUID();
        f.personaService.getAgent.mockResolvedValue({version:1,config_json:{language,industry:'retail',tools:{},rag:{enabled:false},llm:{}}});
        f.revisions.captureProcedures.mockResolvedValue([{id:procedureId,name:'Enrollment',version:1,status:'active',trigger:{keywords:['matricula','enrollment','inscricao','inscription']},steps:[
            {id:'email',type:'ask',config:{field:'email',fieldType:'email',question:'Email?'}},
            {id:'create',type:'tool',config:{tool:'enroll_student',args:{cohortId,studentName:'Eval',studentEmail:'{{ email }}'},saveAs:'enrollment'}},
        ]}]);
        publishTools(f,['enroll_student','book_class']);
        const snapshot=await f.service.captureSnapshot(tenantId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const session:AgentTurnSession={id:randomUUID(),tenantId,agentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',channelType:'telegram',contactId,conversationId,schemaName:lease.schemaName,
            snapshot,sandboxNamespace:lease,mode:'sandbox',executionContext:AGENT_TEST_EXECUTION_CONTEXT,state:new EphemeralTurnState(),metadata:{},history:[],lastMessageAt:new Date().toISOString(),trace:new AgentTurnTrace()};
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const turn=async(text:string)=>{
            const id=(await q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp()) RETURNING id",[conversationId,text]))[0].id;
            session.trace=new AgentTurnTrace();
            await f.runtime.executeAgentTurn({id,tenantId,channelType:'telegram',contactId,content:{type:'text',text},timestamp:new Date()} as any,session);
            expect(session.trace.error).toBeUndefined();return id;
        };
        await turn(request);await turn('customer@example.test');
        expect(session.metadata.missionFocus).toMatchObject({selected:{kind:'procedure',reference:procedureId},expectedReply:{kind:'confirmation'}});
        expect((await q('SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(0);
        f.llmRouter.execute.mockResolvedValueOnce({content:'',toolCalls:[{id:randomUUID(),function:{name:'book_class',arguments:JSON.stringify({classId})}}]});
        const yesId=await turn(yes);
        expect((await q('SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(1);
        expect((await q('SELECT count(*)::int AS n FROM class_bookings'))[0].n).toBe(0);
        expect(session.metadata.missionFocus.lastConsumed.messageId).toBe(yesId);
        expect(await session.state.getJson(`procedure:${conversationId}`)).toBeNull();
        expect(session.trace.toolCalls).toEqual(expect.arrayContaining([expect.objectContaining({name:'enroll_student',result:expect.objectContaining({status:'enrolled',charged:false})})]));
        expect((session.trace.turnContext as any)?.recentActions).toEqual(expect.arrayContaining([expect.objectContaining({tool:'enroll_student'})]));
    });

    it('uses the persisted inbound ID through Eval recorder, AgentTest adapter and real command ledger',async()=>{
        const f=agentTurnFixture({toolExecutor:executor});
        f.tenantsService.getSchemaName.mockResolvedValue(source);
        (f.service as any).namespaces=namespaces;
        publishTools(f,['enroll_student']);
        const snapshot=await f.service.captureSnapshot(tenantId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const recorder=Object.assign(Object.create(EvalService.prototype),{prisma});
        const options={evalMode:true,sandboxNamespace:lease,sandboxContactId:contactId,sandboxConversationId:conversationId,agentSnapshot:snapshot};
        await expect(f.service.test(tenantId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message:'Quiero una matricula'},options)).rejects.toThrow('eval_sandbox_inbound_required');
        let sessionId:string|undefined;
        const run=async(message:string)=>{
            const sandboxInboundMessageId=await recorder.recordSandboxInbound(lease.schemaName,conversationId,message);
            f.llmRouter.execute.mockResolvedValueOnce({content:'',toolCalls:[{id:randomUUID(),function:{name:'enroll_student',arguments:JSON.stringify({cohortId,studentName:'Eval'})}}]});
            const response=await f.service.test(tenantId,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{message,channelType:'telegram',runtimeSessionId:sessionId},{...options,sandboxInboundMessageId});
            sessionId=response.debug.runtimeSessionId;expect(response.debug.runtimeError).toBeUndefined();
            return {response,sandboxInboundMessageId};
        };
        const first=await run('Quiero una matricula');
        expect(first.response.debug.toolCalls[0].result).toMatchObject({error:'confirmation_required'});
        const evidenceScope={tenantId,contactId,conversationId,namespace:lease,assertLease:()=>namespaces.assertOwned(lease)};
        const beforeLedger=await captureLearningLedger(prisma,evidenceScope);
        const second=await run('Sí, confirmo');
        expect(second.response.debug.toolCalls[0].result).toMatchObject({status:'enrolled',charged:false});
        expect(await verifyLearningOperation(prisma,evidenceScope,second.response.debug.toolCalls[0],beforeLedger))
            .toMatchObject({status:'verified',effect:'committed',table:'enrollments'});
        const [ledger]=await prisma.executeInTenantSchema(lease.schemaName,'SELECT confirmation_source_message_id,status FROM tool_execution_ledger');
        expect(ledger).toMatchObject({confirmation_source_message_id:first.sandboxInboundMessageId,status:'succeeded'});
        expect((await prisma.executeInTenantSchema(lease.schemaName,'SELECT count(*)::int AS n FROM enrollments'))[0].n).toBe(1);
    });

    it('rejects competing focus saves and does not resurrect erased mission state',async()=>{
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        // The same canonical tombstone used by command controls, present in the isolated namespace.
        const store=new MissionFocusStore(prisma,lease.schemaName,conversationId,contactId);
        const first=await store.load(),second=await store.load();first.selected={id:randomUUID(),kind:'booking'};second.selected={id:randomUUID(),kind:'procedure'};
        await store.save(first);await expect(store.save(second)).rejects.toThrow('mission_focus_conflict');
        await q('INSERT INTO customer_memory_erasure(contact_id,erased_at) VALUES($1::uuid,NOW()) ON CONFLICT(contact_id) DO UPDATE SET erased_at=NOW()',[contactId]);
        const prior=await store.load();await expect(store.save(prior)).rejects.toThrow('contact_erased');
        expect((await store.load()).writeVersion).toBe(first.writeVersion);
        await expect(persistConversationRuntimeState(prisma,lease.schemaName,conversationId,{bookingState:{customerEmail:'erased@example.test'}})).rejects.toThrow('contact_erased');
        await expect(persistConversationRuntimeState(prisma,lease.schemaName,conversationId,{procedureState:{collected:{email:'erased@example.test'}}})).rejects.toThrow('contact_erased');
        const metadata=(await q('SELECT metadata FROM conversations WHERE id=$1::uuid',[conversationId]))[0].metadata;
        expect(metadata.bookingState).toBeUndefined();expect(metadata.procedureState).toBeUndefined();
    });

    it('uses real capacity transactions: concurrent appointments admit one and leave live rows untouched', async () => {
        const outcomes=await Promise.allSettled([create(),create()]);
        expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
        expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
        expect(effects.emit).not.toHaveBeenCalled();expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
    });
    it('preserves a deposit, pending status and hold instead of claiming confirmation', async()=>{
        await query(`UPDATE "${lease.schemaName}".services SET payment_policy='deposit',deposit_percent=25`);
        const result=await create();
        expect(result).toMatchObject({status:'pending_payment',awaitingPayment:true,amountDueToConfirm:25,currency:'COP'});
        expect(new Date(result.holdExpiresAt!).getTime()).toBeGreaterThan(Date.now());
        expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
    });
    it('rejects changed service terms inside the actual appointment transaction before inserting', async () => {
        const [row] = await query(`SELECT * FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]);
        const expected = appointmentServiceTerms(row);
        await query(`UPDATE "${lease.schemaName}".services SET price=150,payment_policy='deposit',deposit_percent=40 WHERE id=$1::uuid`, [serviceId]);
        await expect(appointments.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service', source: 'ai',
            startAt: `${date}T10:00:00`, endAt: `${date}T10:30:00`, metadata: { source: 'eval_gate' } },
        { expectedServiceTerms: expected, suppressEffects: true, sandboxNamespace: lease })).rejects.toBeInstanceOf(AppointmentTermsChangedError);
        expect((await query(`SELECT count(*)::int AS n FROM "${lease.schemaName}".appointments`))[0].n).toBe(0);
        const [fresh] = await query(`SELECT * FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]);
        const created = await appointments.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service', source: 'ai',
            startAt: `${date}T10:00:00`, endAt: `${date}T10:30:00`, metadata: { source: 'eval_gate' } },
        { expectedServiceTerms: appointmentServiceTerms(fresh), suppressEffects: true, sandboxNamespace: lease });
        expect(created).toMatchObject({ status: 'pending_payment', amountDueToConfirm: 60 });
    });
    it('holds material service terms against a concurrent owner edit until the appointment commits', async () => {
        const [row] = await query(`SELECT * FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]);
        const owner = await pool.connect(); const ownerPid = (await owner.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let ownerWrite: Promise<any> | undefined; let observedLock = false;
        const guarded = { ...prisma, transactionInTenantSchema: (schema: string, work: any) => prisma.transactionInTenantSchema(schema, (q: any) => work(async (sql: string, params: any[] = []) => {
            const rows = await q(sql, params);
            if (sql.includes('FROM services') && sql.includes('FOR SHARE') && !ownerWrite) {
                ownerWrite = owner.query(`UPDATE "${lease.schemaName}".services SET price=200 WHERE id=$1::uuid`, [serviceId]);
                for (let attempt = 0; attempt < 50; attempt++) {
                    const [wait] = await query('SELECT cardinality(pg_blocking_pids($1::int)) AS n', [ownerPid]);
                    if (wait.n > 0) { observedLock = true; break; }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                expect(observedLock).toBe(true);
            }
            return rows;
        })) };
        const command = new AppointmentsService(guarded, effects as any, calendar as any, { timezoneForSchema: async () => 'America/Bogota' } as any);
        try {
            const created = await command.create(lease.schemaName, { contactId, conversationId, serviceId, serviceName: 'Service', source: 'ai',
                startAt: `${date}T10:00:00`, endAt: `${date}T10:30:00`, metadata: { source: 'eval_gate' } },
            { expectedServiceTerms: appointmentServiceTerms(row), suppressEffects: true, confirmWithoutPayment: true, sandboxNamespace: lease });
            expect(created.status).toBe('confirmed'); await ownerWrite;
            expect(Number((await query(`SELECT price FROM "${lease.schemaName}".services WHERE id=$1::uuid`, [serviceId]))[0].price)).toBe(200);
            const target = PAYMENT_REFERENCE_TARGETS.appointment;
            const [payable] = await prisma.executeInTenantSchema(lease.schemaName,
                `SELECT ${target.amountExpression} AS amount, ${target.currencyExpression} AS currency
                 FROM appointments target ${target.join} WHERE target.id=$1::uuid`, [created.id]);
            expect(Number(payable.amount)).toBe(100); expect(payable.currency).toBe('COP');
            expect(created.metadata.serviceTerms.price).toBe(100);
            expect(observedLock).toBe(true);
        } finally { if (ownerWrite) await ownerWrite; owner.release(); }
    });
    it('rolls back invalid enrollment ownership and restores a seat exactly once after cancellation',async()=>{
        await expect(education.enrollStudent(lease.schemaName,{cohortId,contactId:randomUUID(),studentName:'Invalid'})).rejects.toThrow();
        const enrolled=await education.enrollStudent(lease.schemaName,{cohortId,contactId,studentName:'Eval'});
        await expect(education.enrollStudent(lease.schemaName,{cohortId,contactId:otherContact,studentName:'Other'})).rejects.toThrow();
        await education.cancelEnrollment(lease.schemaName,enrolled.id,{contactId});
        await education.cancelEnrollment(lease.schemaName,enrolled.id,{contactId});
        expect((await query(`SELECT available_seats,status FROM "${lease.schemaName}".course_cohorts`))[0]).toMatchObject({available_seats:1,status:'open'});
    });
    it('promotes the real gym waitlist and never charges or refunds credits twice',async()=>{
        const first=await gyms.bookClass(lease.schemaName,classId,memberId);
        const queued=await gyms.bookClass(lease.schemaName,classId,otherMember);
        expect(queued).toMatchObject({status:'waitlist',waitlisted:true});
        expect((await gyms.bookClass(lease.schemaName,classId,memberId)).id).toBe(first.id);
        await gyms.cancelBooking(lease.schemaName,first.id,contactId);
        await gyms.cancelBooking(lease.schemaName,first.id,contactId);
        expect((await query(`SELECT status FROM "${lease.schemaName}".class_bookings WHERE id=$1`,[queued.id]))[0].status).toBe('confirmed');
        expect((await query(`SELECT class_credits_remaining FROM "${lease.schemaName}".members WHERE id=$1`,[memberId]))[0].class_credits_remaining).toBe(2);
        expect((await query(`SELECT class_credits_remaining FROM "${lease.schemaName}".members WHERE id=$1`,[otherMember]))[0].class_credits_remaining).toBe(1);
    });
    it('rejects a forged namespace at the executor before a domain writer',async()=>{
        const result=await executor.execute(source,tenantId,contactId,'create_appointment',{serviceId,date,time:'10:00',customerName:'Eval'},conversationId,{
            authority:{source:'llm_turn',allowedTools:['create_appointment']} as any,executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        expect(result.error).toBeTruthy();
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
    });
    it('binds Flow execution to its current mission, revision and server booking port',async()=>{
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const staff=randomUUID(),missionId=randomUUID(),flowToken=randomUUID();
        await q("INSERT INTO __eval_ref_users(id,tenant_id,is_active,first_name,last_name) VALUES($1::uuid,$2::uuid,true,'Eval','Staff')",[staff,tenantId]);
        await q("INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time) VALUES($1::uuid,$2,'09:00','17:00')",[staff,new Date(`${date}T12:00Z`).getUTCDay()]);
        const id=(await q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text','__flow_response__','delivered',clock_timestamp()) RETURNING id",[conversationId]))[0].id;
        const [service]=await q('SELECT * FROM services WHERE id=$1::uuid',[serviceId]);
        const terms=appointmentServiceTerms(service),state=new EphemeralTurnState();
        await state.setJson(`booking:${conversationId}`,{step:'waiting_flow',missionId,flowToken,flowRevision:3,flowStartedAt:new Date().toISOString(),
            services:[{id:serviceId,appointmentTerms:terms}]});
        const scope:MissionExecutionScopeV1={version:1,kind:'booking',executionOwner:'booking',missionId,revision:3,inboundMessageId:id,
            expectedReply:{kind:'flow',missionId,proposalId:flowToken,sourceMessageId:randomUUID()}};
        const invoke=(token:string=flowToken,missionScope=scope)=>executor.execute(lease.schemaName,tenantId,contactId,'create_appointment',
            {serviceId,staffId:staff,date,time:'10:00',customerName:'Eval',appointmentTerms:terms},conversationId,{
                authority:authorityFor('create_appointment'),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
                executionState:state,missionScope,authorityEvidence:{kind:'booking_engine_confirmation',source:'flow_response',flowToken:token},
            });
        expect((await invoke(flowToken,{...scope,executionOwner:'tool'})).error).toBe('mission_selection_required');
        expect((await invoke('old-form')).error).toBe('booking_flow_evidence_expired');
        expect((await invoke(flowToken,{...scope,revision:4})).error).toBe('booking_flow_evidence_expired');
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(0);
        const created=await invoke();expect(created.error).toBeUndefined();
        expect((await invoke()).error).toBeUndefined();
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(1);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
    });

    it('executes real confirmation, appointment creation, reschedule and cancellation with a local staff directory',async()=>{
        const staff=randomUUID();
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        await q("INSERT INTO __eval_ref_users(id,tenant_id,is_active,first_name,last_name) VALUES($1::uuid,$2::uuid,true,'Eval','Staff')",[staff,tenantId]);
        await q("INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time) VALUES($1::uuid,$2,'09:00','17:00')",[staff,new Date(`${date}T12:00Z`).getUTCDay()]);
        const invoke=(name:string,args:any)=>executor.execute(lease.schemaName,tenantId,contactId,name,args,conversationId,{
            authority:authorityFor(name),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const confirmed=async(name:string,args:any)=>{
            await inbound('Quiero realizar esta operación');
            const challenge=await invoke(name,args);
            expect(challenge).toMatchObject({error:'confirmation_required'});
            await inbound('Sí, confirmo');
            const result=await invoke(name,{...args,_control:{confirmationToken:challenge.confirmationToken}});
            expect(result.error).toBeUndefined();
            return result;
        };
        const slots=await invoke('check_availability',{date,serviceId,staffId:staff});
        expect(slots).toHaveProperty('slots');
        expect(slots.slots.some((slot:any)=>slot.time==='10:00')).toBe(true);
        const created=await confirmed('create_appointment',{serviceId,staffId:staff,date,time:'10:00',customerName:'Eval'});
        expect(created).toMatchObject({success:true,appointment:{status:'confirmed'}});
        const appointmentId=created.appointment.id;
        const moved=await confirmed('reschedule_appointment',{appointmentId,newDate:date,newTime:'11:00'});
        expect(moved).toMatchObject({success:true,appointment:{time:'11:00'}});
        const cancelled=await confirmed('cancel_appointment',{appointmentId});
        expect(cancelled.success).toBe(true);
        expect((await q('SELECT status FROM appointments WHERE id=$1::uuid',[appointmentId]))[0].status).toBe('cancelled');
        expect(effects.emit).not.toHaveBeenCalled();expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
    });
    it.each(['none','deposit'])('executes a vehicle appointment lifecycle with %s payment policy, real consent and the exact owned vehicle', async paymentPolicy => {
        const staff = randomUUID(), vehicle = randomUUID();
        const q = (sql:string, params:any[]=[]) => prisma.executeInTenantSchema(lease.schemaName,sql,params);
        await q("INSERT INTO __eval_ref_users(id,tenant_id,is_active,first_name,last_name) VALUES($1::uuid,$2::uuid,true,'Eval','Staff')", [staff,tenantId]);
        await q("INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time) VALUES($1::uuid,$2,'09:00','17:00')", [staff,new Date(`${date}T12:00Z`).getUTCDay()]);
        await q("INSERT INTO vehicles(id,make,model,year,price_cents,currency,status) VALUES($1::uuid,'EVAL','Isolated Vehicle',2026,1000,'COP','available')", [vehicle]);
        if(paymentPolicy==='deposit')await q("UPDATE services SET payment_policy='deposit',deposit_percent=25 WHERE id=$1::uuid",[serviceId]);
        const expectedStatus=paymentPolicy==='deposit'?'pending_payment':'confirmed';
        const calls:Array<{name:string;result:any}>=[];
        const evidenceScope={tenantId,contactId,conversationId,namespace:lease,assertLease:()=>namespaces.assertOwned(lease)};
        const invoke=async(name:string,args:any)=>{
            const result=await executor.execute(lease.schemaName,tenantId,contactId,name,args,conversationId,{
                authority:authorityFor(name),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
            });
            calls.push({name,result});return result;
        };
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const confirmed=async(name:string,args:any)=>{
            await inbound('Quiero realizar esta operación');
            const challenge=await invoke(name,args); expect(challenge.error).toBe('confirmation_required');
            await inbound('Sí, confirmo');
            const input={...args,_control:{confirmationToken:challenge.confirmationToken}};
            const before=await captureLearningLedger(prisma,evidenceScope);
            const result=await invoke(name,input);expect(result.error).toBeUndefined();
            const evidence=await verifyLearningOperation(prisma,evidenceScope,{name,args:input,result},before);
            expect(evidence.reason).toBeUndefined();expect(evidence).toMatchObject({status:'verified',effect:'committed'});
            const beforeReplay=await captureLearningLedger(prisma,evidenceScope);
            const replay=await invoke(name,input);expect(replay).toMatchObject(JSON.parse(JSON.stringify(result)));
            expect(await verifyLearningOperation(prisma,evidenceScope,{name,args:input,result:replay},beforeReplay)).toMatchObject({status:'verified',effect:'replayed'});
            return result;
        };
        expect((await invoke('search_vehicles',{})).vehicles.map((row:any)=>row.id)).toEqual([vehicle]);
        expect(await invoke('get_vehicle_details',{vehicleId:vehicle})).toMatchObject({id:vehicle,status:'available'});
        expect((await invoke('list_services',{})).services.some((row:any)=>row.id===serviceId)).toBe(true);
        const slots=await invoke('check_availability',{date,serviceId,staffId:staff,vehicleId:vehicle});
        expect(slots.slots.some((slot:any)=>slot.time==='10:00')).toBe(true);
        const created=await confirmed('schedule_test_drive',{vehicleId:vehicle,serviceId,staffId:staff,scheduledDate:date,scheduledTime:'10:00',contactName:'Eval'});
        expect(created).toMatchObject({success:true,appointment:{status:expectedStatus,vehicleId:vehicle,awaitingPayment:paymentPolicy==='deposit'}});
        if(paymentPolicy==='deposit')expect(created.appointment.amountDueToConfirm).toBe(25);
        const appointmentId=created.appointment.id;
        expect(await invoke('get_appointment_details',{appointmentId})).toMatchObject({error:'eval_identity_fixture_required'});
        await q("INSERT INTO __eval_identity_assurance(conversation_id,contact_id,assurance,expires_at) SELECT $1::uuid,$2::uuid,'synthetic_A2',expires_at FROM __eval_namespace",[conversationId,contactId]);
        expect(await invoke('get_appointment_details',{appointmentId})).toMatchObject({vehicleId:vehicle});
        expect((await invoke('list_customer_appointments',{})).appointments.map((row:any)=>row.id)).toEqual([appointmentId]);
        const expected:any[]=[{kind:'db_effect',type:'row_count',family:'appointments',table:'appointments',count:1},
            {kind:'db_effect',type:'row_exists',family:'appointments',table:'appointments',where:{vehicle_id:vehicle,vehicle_terms_id:vehicle,
                service_terms_id:serviceId,service_id:serviceId,assigned_to:staff,start_at:`${date}T10:00:00`,status:expectedStatus}}];
        const verify=()=>verifyExpectedEffects({expected,contactId,verifiers:EVAL_EFFECT_VERIFIERS,observedToolCalls:calls,query:q});
        expect((await verify()).passed).toBe(true);
        expected[1].where.vehicle_id=randomUUID(); expect((await verify()).passed).toBe(false); expected[1].where.vehicle_id=vehicle;
        expect((await verifyExpectedEffects({expected,contactId:otherContact,verifiers:EVAL_EFFECT_VERIFIERS,query:q})).passed).toBe(false);
        const busy=await invoke('check_availability',{date,serviceId,staffId:staff,vehicleId:vehicle});
        expect(busy.slots.some((slot:any)=>slot.time==='10:00')).toBe(false);
        expect(await confirmed('reschedule_appointment',{appointmentId,newDate:date,newTime:'11:00'})).toMatchObject({success:true,appointment:{time:'11:00',vehicleId:vehicle}});
        expect((await confirmed('cancel_appointment',{appointmentId})).success).toBe(true);
        expect((await q('SELECT status FROM appointments WHERE id=$1::uuid',[appointmentId]))[0].status).toBe('cancelled');
        const foreign=randomUUID();
        await q("INSERT INTO appointments(id,contact_id,start_at,end_at,status,customer_name) VALUES($1::uuid,$2::uuid,$3::timestamp,$4::timestamp,'confirmed','Private Other Customer')",
            [foreign,otherContact,`${date}T15:00:00`,`${date}T15:30:00`]);
        expect(await invoke('get_appointment_details',{appointmentId:foreign})).toMatchObject({error:'You can only view your own appointments'});
        expect(JSON.stringify(await invoke('list_customer_appointments',{}))).not.toContain('Private Other Customer');
        expect((await query('SELECT id FROM public.users WHERE id=$1::uuid',[staff]))).toEqual([]);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".vehicles`))[0].n).toBe(0);
        expect(effects.emit).not.toHaveBeenCalled();expect(calendar.enqueueWithQuery).not.toHaveBeenCalled();
        expect(identityBoundary.isVerified).not.toHaveBeenCalled();expect(identityBoundary.startVerification).not.toHaveBeenCalled();
    });
    it('binds synthetic identity to the fixture contact, conversation, tool and expiry',async()=>{
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const scope={schemaName:lease.schemaName,tenantId,contactId,conversationId,toolName:'get_appointment_details',sandboxNamespace:lease};
        expect(await hasEvalIdentityFixture(prisma,scope)).toBe(false);
        await q("INSERT INTO __eval_identity_assurance(conversation_id,contact_id,assurance,expires_at) SELECT $1::uuid,$2::uuid,'synthetic_A2',expires_at FROM __eval_namespace",[conversationId,contactId]);
        expect(await hasEvalIdentityFixture(prisma,scope)).toBe(true);
        for(const patch of [{contactId:otherContact},{conversationId:randomUUID()},{tenantId:randomUUID()},{toolName:'file_claim'}])
            expect(await hasEvalIdentityFixture(prisma,{...scope,...patch})).toBe(false);
        await q('UPDATE conversations SET contact_id=$1::uuid WHERE id=$2::uuid',[otherContact,conversationId]);
        expect(await hasEvalIdentityFixture(prisma,scope)).toBe(false);
        await q('UPDATE conversations SET contact_id=$1::uuid WHERE id=$2::uuid',[contactId,conversationId]);
        await q("UPDATE __eval_identity_assurance SET expires_at=clock_timestamp()-interval '1 second'");
        expect(await hasEvalIdentityFixture(prisma,scope)).toBe(false);
    });
    it('refuses a fixture directory without a current, transaction-checked lease',async()=>{
        const work=(proof:any)=>prisma.transactionInTenantSchema(lease.schemaName,(q:any)=>tenantActorDirectoryWithQuery(q,lease.schemaName,proof));
        await expect(work(undefined)).rejects.toThrow('eval_namespace_lease_required');
        await expect(work({...lease,token:randomUUID()})).rejects.toThrow('eval_namespace_lease_lost');
        await expect(work({...lease,tenantId:randomUUID()})).rejects.toThrow('eval_namespace_lease_lost');
        await expect(work({...lease,sourceSchema:'tenant_wrong_source'})).rejects.toThrow('eval_namespace_lease_lost');
        await expect(work({...lease,schemaName:source})).rejects.toThrow('eval_namespace_scope_mismatch');
        await prisma.executeInTenantSchema(lease.schemaName,"UPDATE __eval_namespace SET expires_at=clock_timestamp()-interval '1 second'");
        await expect(work(lease)).rejects.toThrow('eval_namespace_lease_lost');
    });
    it.each(['education','gym'])('routes %s tools through the real ledger and canonical commands, including retries',async(family)=>{
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const evidenceScope={tenantId,contactId,conversationId,namespace:lease,assertLease:()=>namespaces.assertOwned(lease)};
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const invoke=(name:string,args:any)=>executor.execute(lease.schemaName,tenantId,contactId,name,args,conversationId,{
            authority:authorityFor(name),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        const confirmed=async(name:string,args:any)=>{
            await inbound('Quiero esta operación');
            const challenge=await invoke(name,args);expect(challenge).toMatchObject({error:'confirmation_required'});
            await inbound('Sí, confirmo');
            const input={...args,_control:{confirmationToken:challenge.confirmationToken}};
            const beforeLedger=await captureLearningLedger(prisma,evidenceScope);
            const result=await invoke(name,input);expect(result.error).toBeUndefined();
            expect(await verifyLearningOperation(prisma,evidenceScope,{name,args:input,result},beforeLedger))
                .toMatchObject({status:'verified',effect:'committed'});
            const beforeReplay=await captureLearningLedger(prisma,evidenceScope);
            const repeated=await invoke(name,input);expect(repeated).toMatchObject(result);
            expect(await verifyLearningOperation(prisma,evidenceScope,{name,args:input,result:repeated},beforeReplay))
                .toMatchObject({status:'verified',effect:'replayed'});
            return result;
        };
        if(family==='education') {
            await confirmed('enroll_student',{cohortId,studentName:'Eval'});
            const [row]=await q('SELECT id FROM enrollments');
            await confirmed('cancel_enrollment',{enrollmentId:row.id});
            expect((await q('SELECT available_seats FROM course_cohorts'))[0].available_seats).toBe(1);
        } else {
            await confirmed('book_class',{classId});
            const [row]=await q('SELECT id FROM class_bookings');
            await confirmed('cancel_class_booking',{bookingId:row.id});
            expect((await q('SELECT class_credits_remaining FROM members WHERE id=$1::uuid',[memberId]))[0].class_credits_remaining).toBe(2);
        }
    });
    it('prepares actual EvalSession fixtures in a new namespace and removes them even after lease loss',async()=>{
        let lost=false;const disposed:string[]=[];
        const redis={acquireLockToken:async()=>randomUUID(),renewLockToken:async()=>!lost,releaseLockToken:async()=>true};
        const service=new EvalService(prisma,{} as any,{} as any,redis as any,effects as any,undefined,namespaces);
        await expect(service.withSandboxSession(tenantId,async session=>{
            await session.reset('telegram');
            disposed.push(session.sandboxNamespace!.schemaName);
            expect(session.fixtures?.status).toBe('ready');
            const first=session.sandboxNamespace!;
            await session.recordInbound('Hola');
            expect((await query(`SELECT count(*)::int AS n FROM "${first.schemaName}".messages`))[0].n).toBe(1);
            await session.reset('telegram');disposed.push(session.sandboxNamespace!.schemaName);
            expect(session.sandboxNamespace!.schemaName).not.toBe(first.schemaName);
            expect((await query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[first.schemaName]))).toHaveLength(0);
            lost=true;await session.assertLease();
        })).rejects.toThrow('eval_sandbox_lease_lost');
        for(const schema of disposed) expect((await query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema]))).toHaveLength(0);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".contacts`))[0].n).toBe(0);
    });
    it('requires a later consent for waitlist when the confirmed seat was taken meanwhile',async()=>{
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const inbound=(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        const invoke=(args:any)=>executor.execute(lease.schemaName,tenantId,contactId,'enroll_student',args,conversationId,{
            authority:authorityFor('enroll_student'),executionContext:AGENT_TEST_EXECUTION_CONTEXT,evalMode:true,sandboxNamespace:lease,
        });
        const args={cohortId,studentName:'Eval'};
        await inbound('Quiero matricularme');expect(await invoke(args)).toMatchObject({error:'confirmation_required',allowWaitlist:false,enrollmentTerms:{cohortId}});
        await education.enrollStudent(lease.schemaName,{cohortId,contactId:otherContact,studentName:'Other'});
        await inbound('Sí, confirmo');
        expect(await invoke(args)).toMatchObject({error:'cohort_full_waitlist_requires_consent',requiresConfirmation:true,persisted:false,waitlistAvailable:true});
        expect((await q('SELECT * FROM enrollments WHERE contact_id=$1::uuid',[contactId]))).toHaveLength(0);
        const waitlist={...args,allowWaitlist:true};
        expect(await invoke(waitlist)).toMatchObject({error:'confirmation_required',allowWaitlist:true});
        expect(await invoke(waitlist)).toMatchObject({error:'confirmation_required'});
        expect((await q('SELECT * FROM enrollments WHERE contact_id=$1::uuid',[contactId]))).toHaveLength(0);
        await inbound('Sí, confirmo');const joined=await invoke(waitlist);
        expect(joined).toMatchObject({status:'waitlisted',charged:false});expect(joined.payableReference).toBeNull();
        expect(await invoke(waitlist)).toMatchObject(joined);
        expect((await q('SELECT * FROM enrollments WHERE contact_id=$1::uuid',[contactId]))).toHaveLength(1);
        expect((await q('SELECT available_seats FROM course_cohorts'))[0].available_seats).toBe(0);
    });
    it('also provisions and cleans through the production Prisma transaction adapter',async()=>{
        // This constructor does not run Nest's startup/migration hooks. The URL
        // above has already been restricted to the explicit disposable database.
        const original=process.env.DATABASE_URL;
        process.env.DATABASE_URL=connection!;
        const real=new PrismaService();let target:any;
        try {
            await real.$connect();
            const manager=isolatedEvalNamespaceForPrisma(real);
            target=await manager.provision(tenantId,source,['contacts']);
            await manager.assertOwned(target);
            await real.executeInTenantSchema(target.schemaName,
                "INSERT INTO contacts(id,external_id,channel_type,name) VALUES($1::uuid,'prisma-test','web_widget','Eval')",[randomUUID()]);
            expect((await real.executeInTenantSchema<any[]>(target.schemaName,'SELECT count(*)::int AS n FROM contacts'))[0].n).toBe(1);
            await manager.dispose(target);target=undefined;
        } finally {
            if(target) await isolatedEvalNamespaceForPrisma(real).dispose(target);
            await real.$disconnect();
            if(original===undefined) delete process.env.DATABASE_URL;else process.env.DATABASE_URL=original;
        }
    });
    it('persists a draft review without an appointment, then resumes the approved command exactly once',async()=>{
        const agentId=randomUUID();
        const q=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(lease.schemaName,sql,params);
        const config={behavior:{draftMode:true},hours:{timezone:'America/Bogota'},tools:{appointments:{enabled:true}}};
        await q("INSERT INTO agent_personas(id,name,is_active,config_json,version) VALUES($1::uuid,'Eval Agent',true,$2::jsonb,1)",[agentId,JSON.stringify(config)]);
        const [agentRow]=await q('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]);
        const operationalScope={kind:'agent' as const,tenantId,schemaName:lease.schemaName,agentId,version:1,operationalHash:operationalConfigurationHash(agentRow)};
        await q('UPDATE conversations SET agent_persona_id=$1::uuid WHERE id=$2::uuid',[agentId,conversationId]);
        // These are explicit test boundary adapters. All SQL, approval state
        // transitions and domain commands below are their production classes.
        const ownedPrisma={...prisma,getTenantSchemaName:async()=>lease.schemaName,
            tenant:{findUnique:async()=>({industry:'beauty',settings:{},operatingCountry:'CO'})}};
        const controls=new ToolExecutionControlService(ownedPrisma,{get:()=> 'isolated-test-secret-length-32-characters'} as any,{} as any,{get:async()=>null,incr:async()=>1,expire:async()=>true} as any);
        const args={serviceId,date,time:'10:00',customerName:'Eval'};
        const draftExecutor=Object.create(executor) as AIToolExecutorService;
        (draftExecutor as any).toolExecutionControl=controls;
        const propose=(input:any)=>draftExecutor.execute(lease.schemaName,tenantId,contactId,'create_appointment',input,conversationId,
            {authority:authorityFor('create_appointment'),evalMode:true,sandboxNamespace:lease,
                executionContext:{mode:'draft',persistence:'disabled'},draftScope:{agentId,agentVersion:1},operationalScope});
        const inbound=async(text:string)=>q("INSERT INTO messages(conversation_id,direction,content_type,content_text,status,created_at) VALUES($1::uuid,'inbound','text',$2,'delivered',clock_timestamp())",[conversationId,text]);
        await inbound('Quiero reservar');
        const challenge=await propose(args);
        expect(challenge).toMatchObject({error:'confirmation_required',service:{price:100}});
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(0);
        await inbound('Sí, confirmo');
        const proposal=await propose({...args,_control:{confirmationToken:challenge.confirmationToken}});
        expect(proposal).toMatchObject({error:'draft_action_requires_approval'});
        const [ticket]=await q('SELECT id,status FROM tool_approval_tickets');
        expect(ticket.status).toBe('pending');expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(0);
        await controls.decideApprovalTicket({tenantId,ticketId:ticket.id,actorId:randomUUID(),decision:'approved'});
        const commandPort={execute:(...input:any[])=>executor.execute(input[0],input[1],input[2],input[3],input[4],input[5],{
            ...input[6],evalMode:true,sandboxNamespace:lease,executionContext:AGENT_TEST_EXECUTION_CONTEXT,
        })};
        const workflow=new ToolApprovalWorkflowService(ownedPrisma,controls,commandPort as any,{emitAsync:async()=>{throw new Error('outbound_forbidden');}} as any,{} as any,
            {resolve:async()=>({authority:authorityFor('create_appointment'),status:{}})} as any,
            {getAgent:async()=>(await q('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]))[0]} as any);
        const completed=await workflow.resumeApprovedTicket(tenantId,ticket.id);
        expect(completed).toMatchObject({state:'completed',result:{success:true}});
        expect(await workflow.resumeApprovedTicket(tenantId,ticket.id)).toMatchObject({state:'completed'});
        expect((await q('SELECT count(*)::int AS n FROM appointments'))[0].n).toBe(1);
        expect((await query(`SELECT count(*)::int AS n FROM "${source}".appointments`))[0].n).toBe(0);
        expect(effects.emit).not.toHaveBeenCalled();
    });
});
