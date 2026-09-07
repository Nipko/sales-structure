import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CONVERSATIONAL_CHANNELS } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { assessAgentRelease, type AgentReleaseRunEvidence } from './agent-release-policy';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { releaseReviewSubject } from './agent-release-review-subject';
import { releaseOperationReview } from './agent-release-operation-review';

export const RELEASE_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const AGENT_RELEASE_QUEUE='agent-release-evaluation';
export const RELEASE_TABLES=['agent_release_candidates','agent_release_evaluations','agent_release_reviews'];
export interface ReleaseActor {id:string;role:string}
export interface RequestAgentRelease {configurationRevisionId:string;requestKey:string}
export interface ReviewAgentRelease {
    expectedVersion:number; evidenceHash:string; decision:'approve'|'reject'; requestKey:string;
    checks:{objective:boolean;instructions:boolean;facts:boolean;tools:boolean;style:boolean;limits:boolean};
    sampleHashes:string[];
}
export function assertReleaseActor(actor:ReleaseActor,write=true):void {
    if(!actor||!RELEASE_UUID.test(actor.id)||!(write?['tenant_admin','super_admin']:['tenant_admin','tenant_supervisor','super_admin']).includes(actor.role))
        throw new ForbiddenException({error:'agent_release_role_required'});
}
export function assertReleaseIds(...ids:string[]):void {
    if(ids.some(id=>typeof id!=='string'||!RELEASE_UUID.test(id)))throw new BadRequestException({error:'agent_release_scope_invalid'});
}
export function assertReleaseRequestKey(value:string):void {
    if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(value))throw new BadRequestException({error:'agent_release_request_invalid'});
}
export function assertReleaseChannels(snapshot:AgentEvaluationSnapshot):string[] {
    const channels=snapshot.releaseScope?.channels;
    if(!channels?.length||new Set(channels).size!==channels.length||channels.some(channel=>!(CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel)))
        throw new BadRequestException({error:'agent_release_channels_required'});
    return channels.slice().sort();
}
/** Evidence is taken only from persisted worker results. Request bodies cannot contribute a score or a transcript. */
export function releaseReviewEvidence(candidate:any,evaluations:any[]) {
    const snapshot=candidate.agent_snapshot as AgentEvaluationSnapshot;
    const runs=evaluations.filter(row=>row.status==='completed').map(row=>row.evidence as AgentReleaseRunEvidence);
    const readiness=assessAgentRelease({agentId:candidate.agent_id,dependencyRevision:snapshot?.manifest?.revision||'',
        configHash:snapshot?.configHash||'',scope:snapshot?.releaseScope,runs});
    const samples:Array<{channel:string;language:string;scenario:string;transcript:any[];hash:string}>=[];
    for(const channel of candidate.channels||[])for(const language of snapshot?.releaseScope?.languages||[]) {
        const run=runs.find(row=>row?.channelType===channel);
        const scenario=run?.scenarios.find(row=>row.language===language);
        const attempt=run?.results.find(row=>row.key===scenario?.key)?.runs?.[0];
        if(!scenario||!Array.isArray(attempt?.transcript)||!attempt.transcript.length||attempt.transcriptTruncated)continue;
        const sample={channel,language,scenario:scenario.key,transcript:attempt.transcript};
        samples.push({...sample,hash:revisionHash(sample)});
    }
    const expectedSamples=(candidate.channels?.length||0)*(snapshot?.releaseScope?.languages?.length||0);
    const complete=evaluations.length===(candidate.channels?.length||0)&&evaluations.every(row=>row.status==='completed')
        &&new Set(evaluations.map(row=>row.channel_type)).size===evaluations.length
        &&evaluations.every(row=>candidate.channels.includes(row.channel_type)&&row.evidence?.channelType===row.channel_type);
    const body={candidateId:candidate.id,configurationRevisionId:candidate.configuration_revision_id,
        subject: releaseReviewSubject(snapshot),
        operationChecks: releaseOperationReview(snapshot, runs),
        dependencyRevision:snapshot?.manifest?.revision||null,configurationHash:snapshot?.configurationRevisionHash||null,
        runHashes:runs.map(row=>row.evidenceHash).sort(),readiness,sampleHashes:samples.map(row=>row.hash).sort()};
    return {...body,evidenceHash:revisionHash(body),samples,
        eligibleForReview:complete&&readiness.eligibleForReview&&samples.length===expectedSamples&&expectedSamples>0,
        activationAllowed:false,certified:false};
}
