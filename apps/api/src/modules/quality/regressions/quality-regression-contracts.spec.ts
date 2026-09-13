import { buildRegressionProposal, regressionScope, reviewedRegressionScenario, sanitizeRegressionRevision, validateRegressionAssertions } from './quality-regression-contracts';
import { regressionAppliesToSnapshot, regressionCaseIds } from './quality-regression-runtime';

const scope=regressionScope({profileId:'salud/dental',mission:'ask_question',language:'es',channel:'web_widget',difficulty:'standard',provenance:'human_review'});
const source={agentId:'10000000-0000-4000-8000-000000000001',hash:'source',revision:'2',agentVersion:4};
const caseId='10000000-0000-4000-8000-000000000002';
const draft=()=>buildRegressionProposal([{direction:'inbound',content_text:'¿Cuáles son los horarios?'}],1,[]);
describe('reviewed production regression contracts',()=>{
    it.each(['es','en','pt','fr'])('redacts identifiers and secrets without claiming anonymous text (%s)',language=>{
        const proposal=buildRegressionProposal([{direction:'inbound',content_text:`${language} Soy Ada Lovelace, ada@example.org, +573001234567. api_key=private-secret-value`}],4,['Ada Lovelace']);
        expect(JSON.stringify(proposal)).not.toMatch(/Ada Lovelace|ada@example|573001234567|private-secret/);
        expect(proposal.privacyState).toBe('redacted_requires_review');
        expect(proposal.coverage).toMatchObject({sourceMessages:4,selectedMessages:1,omittedMessages:3});
    });
    it('reports source truncation and keeps more than the trace 500-character limit',()=>{
        const proposal=buildRegressionProposal([{direction:'inbound',content_text:'word '.repeat(600)}],1,[]);
        expect(proposal.messages[0]).toHaveLength(2000);expect(proposal.coverage.truncatedMessages).toBe(1);
    });
    it('requires a known contract mission and explicit reviewed difficulty',()=>{
        expect(()=>regressionScope({...scope,mission:'invented'},true)).toThrow();
        expect(()=>regressionScope({...scope,difficulty:'unknown'},true)).toThrow();
        expect(()=>reviewedRegressionScenario(caseId,1,scope,draft(),source)).toThrow();
    });
    it('preserves synthetic fixture dates while redacting known contacts and preserving honest coverage',()=>{
        const input={...draft(),title:'Test',criteria:'Ask one question',messages:['Ada Lovelace pide {{date}} a las 10:00 por 20 USD.']};
        const clean=sanitizeRegressionRevision(input,draft().coverage,['Ada Lovelace']);
        expect(clean.messages[0]).toBe('[person] pide {{date}} a las 10:00 por 20 USD.');
        expect(clean.observedReplies).toEqual([]);
    });
    it('rejects arbitrary SQL, missing verifier and malformed filters',()=>{
        for(const actions of [[{kind:'db_effect',type:'row_exists',family:'appointments',table:'users'}],
            [{kind:'db_effect',type:'row_exists',family:'appointments',table:'appointments',where:{'id; DROP TABLE messages':1}}],
            [{kind:'tool_call',type:'called',tool:'invented'}]])expect(()=>validateRegressionAssertions(actions)).toThrow();
    });
    it('binds case, revision, agent, source and scope instead of trusting a reserved key',()=>{
        const reviewed=reviewedRegressionScenario(caseId,3,scope,{...draft(),title:'Reviewed answer',criteria:'Explain the configured hours.'},source);
        expect(regressionCaseIds([reviewed.scenario])).toEqual([caseId]);
        expect(()=>regressionCaseIds([{key:reviewed.scenario.key}])).toThrow();
        expect(regressionAppliesToSnapshot(reviewed.scenario,{agentId:source.agentId,releaseScope:{profileId:scope.profileId,intentKeys:['ask_question']}},'web_widget')).toBe(true);
        expect(regressionAppliesToSnapshot(reviewed.scenario,{agentId:source.agentId,releaseScope:{profileId:scope.profileId,intentKeys:['book_appointment']}},'web_widget')).toBe(false);
    });
});
