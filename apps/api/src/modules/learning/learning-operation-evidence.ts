import { createHash } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { EVAL_SANDBOX_CONTACT_ID,EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';
import { getToolPolicy } from '../conversations/tool-policy-registry';
import { attachWriterActiveObject,WRITER_ACTIVE_OBJECTS } from '../conversations/writer-active-object';
import { CANONICAL_EVAL_TOOL_FAMILIES,type EvalNamespaceLease } from '../simulation/isolated-eval-namespace';
import { catalogCents } from '../orders/catalog-order-contract';

export interface LearningOperationScope {
    tenantId:string;contactId:string;conversationId:string;namespace:EvalNamespaceLease|undefined;assertLease:()=>Promise<void>;
}
export interface LearningLedgerSnapshot {available:boolean;entries:Record<string,{tool:string;resultHash:string;requestHash:string}>;}
export interface LearningOperationEvidence {
    status:'verified'|'unverified'|'not_applicable';reason?:string;
    effect?:'committed'|'replayed';table?:string;objectId?:string;objectHash?:string;
    ledgerId?:string;resultHash?:string;requestHash?:string;
    state?:{status?:string;paymentStatus?:string;version?:number};
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** The central replay marker adds no command fact; all other response fields remain bound. */
export function learningResultHash(value:unknown):string {
    const clean=JSON.parse(JSON.stringify(value??null));
    if(record(clean))delete clean.idempotentReplay;
    const stable=(item:any):any=>Array.isArray(item)?item.map(stable):record(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,stable(item[key])])):item;
    return createHash('sha256').update(JSON.stringify(stable(clean))).digest('hex');
}
async function schemaFor(scope:LearningOperationScope):Promise<string>{
    const lease=scope.namespace;
    if(!lease||lease.tenantId!==scope.tenantId||!/^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/.test(lease.schemaName)
        ||lease.schemaName===lease.sourceSchema||scope.contactId!==EVAL_SANDBOX_CONTACT_ID||!UUID.test(scope.conversationId))throw new Error('learning_evidence_namespace_required');
    await scope.assertLease();return lease.schemaName;
}
async function ledgerRows(prisma:PrismaService,scope:LearningOperationScope){
    const schema=await schemaFor(scope);
    const exists=await prisma.executeInTenantSchema<any[]>(schema,'SELECT to_regclass($1)::text AS relation',[`${schema}.tool_execution_ledger`]);
    if(!exists[0]?.relation)return null;
    const rows=await prisma.executeInTenantSchema<any[]>(schema,`SELECT id::text,tool_name,args_hash,response_payload
        FROM tool_execution_ledger WHERE contact_id=$1::uuid AND conversation_id=$2::uuid AND status='succeeded'`,[scope.contactId,scope.conversationId]);
    await scope.assertLease();return rows;
}
export async function captureLearningLedger(prisma:PrismaService,scope:LearningOperationScope):Promise<LearningLedgerSnapshot>{
    const rows=await ledgerRows(prisma,scope);
    return {available:rows!==null,entries:Object.fromEntries((rows||[]).map(row=>[row.id,{tool:row.tool_name,resultHash:learningResultHash(row.response_payload),requestHash:row.args_hash}]))};
}
/** A table changing is not evidence about a particular command. Match its durable
 * response, exact object and owner; unchanged valid replays are expected. */
export async function verifyLearningOperation(prisma:PrismaService,scope:LearningOperationScope,
    call:{name:string;args?:Record<string,unknown>;result?:unknown},before:LearningLedgerSnapshot):Promise<LearningOperationEvidence>{
    const result=call.result,policy=getToolPolicy(call.name);
    if(policy?.effect==='read')return {status:'not_applicable'};
    if(!record(result))return {status:'unverified',reason:'result_unavailable'};
    if(result.error||result.isError||result.success===false||result.ok===false)return {status:'not_applicable'};
    const familyKey=CANONICAL_EVAL_TOOL_FAMILIES[call.name],family=EVAL_WRITER_SANDBOX_FAMILIES[familyKey];
    if(!family||family.status!=='audited'||!family.contactColumn||!WRITER_ACTIVE_OBJECTS[call.name]?.kind)return {status:'unverified',reason:'verifier_unavailable'};
    // Do not let an inconsistent display reference hide the handler's target.
    const {activeObject:displayReference,...handlerResult}=result;
    const reference=(attachWriterActiveObject(call.name,handlerResult,call.args) as any)?.activeObject;
    if(!reference||reference.kind!==WRITER_ACTIVE_OBJECTS[call.name].kind||!UUID.test(reference.id||''))return {status:'unverified',reason:'object_reference_missing'};
    if(displayReference&&(displayReference.kind!==reference.kind||displayReference.id!==reference.id))return {status:'unverified',reason:'object_reference_mismatch'};
    const resultHash=learningResultHash(result),rows=await ledgerRows(prisma,scope);
    if(rows===null)return {status:'unverified',reason:'ledger_unavailable'};
    const matching=rows.filter(row=>row.tool_name===call.name&&learningResultHash(row.response_payload)===resultHash&&/^[a-f0-9]{64}$/.test(row.args_hash||''));
    if(matching.length!==1)return {status:'unverified',reason:matching.length?'ledger_ambiguous':'ledger_result_missing'};
    const ledger=matching[0],schema=scope.namespace!.schemaName;
    const exists=await prisma.executeInTenantSchema<any[]>(schema,'SELECT to_regclass($1)::text AS relation',[`${schema}.${family.table}`]);
    if(!exists[0]?.relation)return {status:'unverified',reason:'object_table_unavailable'};
    // Identifiers come only from the reviewed family registry. Row data never
    // leaves this verifier; returned traces contain hashes and operational state.
    const objects=await prisma.executeInTenantSchema<any[]>(schema,`SELECT md5(to_jsonb(t)::text) AS hash,to_jsonb(t) AS data
        FROM ${family.table} t WHERE id=$1::uuid AND ${family.contactColumn}=$2::uuid`,[reference.id,scope.contactId]);
    await scope.assertLease();
    if(objects.length!==1)return {status:'unverified',reason:'owned_object_missing'};
    const object=objects[0].data,body=result.order||result.appointment||result.repairOrder||result.enrollment||result;
    if(family.table==='pets'){
        const receipts=await prisma.executeInTenantSchema<any[]>(schema,'SELECT to_regclass($1)::text AS relation',[`${schema}.pet_command_receipts`]);
        if(!receipts[0]?.relation)return {status:'unverified',reason:'pet_receipt_unavailable'};
        // The receipt and pet were committed atomically. Rehydrate the recorded
        // SQL types so date/decimal JSON representations cannot hide a mismatch.
        // Compare all business columns; database-maintained timestamps do not
        // change what was registered or corrected.
        const proof=await prisma.executeInTenantSchema<any[]>(schema,`SELECT
            (to_jsonb(p)-'created_at'-'updated_at')=(to_jsonb(expected)-'created_at'-'updated_at') AS state_matches,
            md5(to_jsonb(p)::text) AS object_hash
            FROM pet_command_receipts r
            JOIN tool_execution_ledger l ON l.idempotency_key=r.command_key
            JOIN pets p ON p.id=r.pet_id AND p.contact_id=r.contact_id
            CROSS JOIN LATERAL jsonb_populate_record(NULL::pets,r.response_row) AS expected
            WHERE l.id=$1::uuid AND l.contact_id=$2::uuid AND l.conversation_id=$3::uuid AND l.status='succeeded'
                AND r.contact_id=$2::uuid AND r.pet_id=$4::uuid AND r.command_kind=$5`,
            [ledger.id,scope.contactId,scope.conversationId,reference.id,call.name==='register_pet'?'create':'update']);
        await scope.assertLease();
        if(proof.length!==1)return {status:'unverified',reason:'pet_receipt_missing'};
        if(proof[0].state_matches!==true||proof[0].object_hash!==objects[0].hash||object.is_active!==true
            ||(call.name==='register_pet'&&(body.name!==object.name||body.species!==object.species||body.breed!==object.breed)))
            return {status:'unverified',reason:'pet_record_mismatch'};
    }
    const cancellation:Record<string,string>={cancel_catalog_order:'cancelled',cancel_appointment:'cancelled',cancel_repair_order:'cancelled',cancel_class_booking:'cancelled',cancel_enrollment:'dropped'};
    const expectedStatus=cancellation[call.name]||body.status;
    const currency=family.table==='appointments'?object.metadata?.serviceTerms?.currency:object.currency;
    if((expectedStatus!==undefined&&expectedStatus!==object.status)||(body.paymentStatus!==undefined&&body.paymentStatus!==object.payment_status)
        ||(body.currency!==undefined&&body.currency!==currency)||(body.version!==undefined&&body.version!==object.version))return {status:'unverified',reason:'object_state_mismatch'};
    if(call.name==='schedule_test_drive' && (!body.vehicleId || body.vehicleId!==object.metadata?.vehicleId
        ||body.vehicleId!==object.metadata?.vehicleTerms?.vehicleId
        ||body.vehicleLabel!==object.metadata?.vehicleTerms?.label
        ||object.service_id!==object.metadata?.serviceTerms?.serviceId))return {status:'unverified',reason:'vehicle_appointment_terms_mismatch'};
    if(family.table==='orders'){
        try{
            const amount=String(catalogCents(object.total_amount));
            if((body.totalAmountCents!==undefined&&String(body.totalAmountCents)!==amount)
                ||(body.totalAmount!==undefined&&String(catalogCents(body.totalAmount))!==amount))return {status:'unverified',reason:'object_amount_mismatch'};
        }catch{return {status:'unverified',reason:'object_amount_unavailable'};}
    }
    const prior=before.entries[ledger.id];
    if(prior&&(prior.resultHash!==resultHash||prior.requestHash!==ledger.args_hash||prior.tool!==call.name))return {status:'unverified',reason:'ledger_changed'};
    return {status:'verified',effect:prior?'replayed':'committed',table:family.table,objectId:reference.id,objectHash:objects[0].hash,
        ledgerId:ledger.id,resultHash,requestHash:ledger.args_hash,
        state:{...(typeof object.status==='string'?{status:object.status}:{}),...(typeof object.payment_status==='string'?{paymentStatus:object.payment_status}:{}),
            ...(Number.isInteger(object.version)?{version:object.version}:{})}};
}
