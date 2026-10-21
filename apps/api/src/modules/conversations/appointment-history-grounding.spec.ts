import { PromptAssemblerService } from './prompt-assembler.service';
// A bounded active view omits a completed appointment. It is not a not-found result.
describe('historical appointment lookup contract',()=>{
 const service=new PromptAssemblerService({buildSystemPrompt:()=>'<persona/>'} as any);
 const prompt=service.assemble({persona:{}} as any,{language:'es',timezone:'America/Bogota',activeObjects:{items:[],asOf:'2026-10-21T10:00:00Z'}} as any);
 it('does not certify absence from an empty active snapshot',()=>{expect(prompt).toContain('absence NEVER proves');expect(prompt).toContain('past, completed or cancelled appointment');});
 it('requires the canonical read before denying a supplied reference',()=>{expect(prompt).toContain('call get_appointment_details');expect(prompt).toContain('in THIS turn when available');expect(prompt).toContain('do not deny the record or ask permission merely to perform that read');});
 it('keeps identity and step-up controls even for a supplied reference',()=>{expect(prompt).toContain('never infer verification from a reference or bypass a challenge');expect(prompt).toContain('without claiming the appointment is absent');});
 it('preserves historical quotation and payment uncertainty',()=>{expect(prompt).toContain("never substitute today's catalogue price");expect(prompt).toContain('treat an example zero as free');expect(prompt).toContain('equate completion with payment');});
});
