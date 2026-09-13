import { isCanonicalConsentRecovery } from './canonical-consent-recovery';
import { enrollmentTermsReviewResult,enrollmentTerms } from '../education/enrollment-terms';
const terms=enrollmentTerms({id:'course',name:'Course',price:100,currency:'COP'},{id:'cohort',starts_at:'2099-01-01'});
describe('canonical consent recovery boundary',()=>{
    it('recovers reviewed education terms but rejects arbitrary tool claims and persisted failures',()=>{
        const result=enrollmentTermsReviewResult(terms,true,'cohort_full_waitlist_requires_consent');
        expect(isCanonicalConsentRecovery('enroll_student',result)).toBe(true);
        expect(isCanonicalConsentRecovery('mcp__enroll_student',result)).toBe(false);
        expect(isCanonicalConsentRecovery('enroll_student',{...result,persisted:true})).toBe(false);
        expect(isCanonicalConsentRecovery('enroll_student',{...result,enrollmentTerms:undefined})).toBe(false);
        expect(isCanonicalConsentRecovery('enroll_student',{...result,error:'unexpected_failure'})).toBe(false);
    });
});
