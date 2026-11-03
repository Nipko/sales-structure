import { PromptAssemblerService } from './prompt-assembler.service';

/**
 * C15 (E2h, 2-nov-2026): asked whether «Audífono QA Aurora» was available, the agent read check_stock (2 units) and answered
 * «Sí, tenemos disponibilidad», without the figure; the verifier removed the bare claim and the customer got only the
 * not-confirmed notice. The figure the read gave is the answer.
 */
describe('C15: availability is answered with its figure', () => {
    it('the contract carries rule 13i', () => {
        const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona/>' } as any);
        const contract = (assembler as any).buildContractLayer() as string;
        expect(contract).toContain('13i. AVAILABILITY WITH ITS FIGURE');
        expect(contract).toMatch(/Never answer only "sí, hay disponibilidad"/);
    });
});
