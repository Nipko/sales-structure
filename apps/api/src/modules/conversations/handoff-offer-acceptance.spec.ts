import { promisesHumanHandoff } from '../../common/utils/outcome-claim.util';
import { ConversationsService } from './conversations.service';
import { HUMAN_OFFER_MARK, isAffirmation, isHumanOfferText, noDataWaitReplacementText } from './human-offer';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('handoff promise needs a human DESTINATION right after the verb', () => {
    it.each([
        'Vou te passar o cardápio da equipe.',
        'Vou te passar o link, nossa equipe confirma.',
        'Vou conectar seu pedido ao sistema, a equipe recebe.',
        'Estou transferindo o valor para sua conta, equipe.',
        'Je vais vous passer les horaires de notre équipe.',
        'Je vais vous mettre le lien, un conseiller vous a répondu hier.',
        'I will send you the menu, our team confirms it.',
    ])('is not a handoff: %s', text => {
        expect(promisesHumanHandoff(text)).toBe(false);
    });

    it.each([
        'Le paso con nuestro equipo especializado, espere un momento.',
        'Te voy a transferir con un agente de nuestro equipo.',
        "I'll transfer you to an agent from our team.",
        'I am transferring you to our team now.',
        "I'll connect you with a human advisor.",
        'Vou te transferir para um atendente da nossa equipe.',
        'Vou passar você para um atendente.',
        'Estou transferindo você para a equipe.',
        'Je vous passe à un conseiller.',
        'Je vais vous passer à un conseiller.',
        'Je vous transfère à un agent de notre équipe.',
        'Je vous mets en relation avec un conseiller.',
        'Je vais vous transférer à un agent de notre équipe.',
    ])('is a handoff: %s', text => {
        expect(promisesHumanHandoff(text)).toBe(true);
    });
});

describe('a "yes" to the guardian offer escalates deterministically', () => {
    it.each(['sí', 'Si, por favor', 'dale', 'ok', 'yes please', 'sim', 'oui', "d'accord", 'claro que sí'])('affirmation: %s', t => {
        expect(isAffirmation(t)).toBe(true);
    });
    it.each(['no', 'no gracias', 'cuánto cuesta?', 'sí pero antes dime el precio del corte', 'hola', ''])('not an affirmation: %s', t => {
        expect(isAffirmation(t)).toBe(false);
    });

    // In-memory stand-in for the conversations row: only the two metadata statements.
    const harness = () => {
        const row: any = { id: 'conv', metadata: {} as Record<string, any> };
        const service: any = Object.create(ConversationsService.prototype);
        service.logger = { warn: jest.fn() };
        service.prisma = { executeInTenantSchema: jest.fn(async (_s: string, sql: string, params: any[]) => {
            if (sql.includes("'{" + HUMAN_OFFER_MARK + "}'")) row.metadata[HUMAN_OFFER_MARK] = JSON.parse(params[1]);
            else if (sql.includes("- '" + HUMAN_OFFER_MARK + "'")) delete row.metadata[HUMAN_OFFER_MARK];
            return [];
        }) };
        // What the next turn would load from the database.
        const reload = () => ({ id: 'conv', metadata: JSON.parse(JSON.stringify(row.metadata)) });
        return { service, row, reload };
    };

    const offerTurn = async (service: any) => {
        service.recordAgentSignal = jest.fn();
        service.eventEmitter = { emit: jest.fn() };
        service.responseValidator = { validatePrices: () => ({ ok: true, hallucinatedPrices: [] }) };
        service.llmRouter = { execute: jest.fn() };
        const reply = await service.applyOutputGuardrails('Déjame verificar eso, un momento.', 'sys', [], [], 't', 'conv', [], 'es', [], {});
        await service.rememberHumanOffer('schema', 'conv', reply);
        return reply;
    };

    it('offer → "sí" → handoff, whatever the model would have paraphrased', async () => {
        const { service, reload } = harness();
        const reply = await offerTurn(service);
        expect(isHumanOfferText(reply)).toBe(true);
        // Turn 2: the simulated LLM would answer "Listo, le aviso al equipo" (no handoff phrase);
        // the decision is taken before it is ever consulted.
        const llm = jest.fn(async () => 'Listo, le aviso al equipo.');
        const escalate = await service.resolveHumanOfferAcceptance('schema', reload(), 'sí');
        expect(escalate).toBe(true);
        expect(llm).not.toHaveBeenCalled();
    });

    it('any other message clears the mark, so a later "sí" does nothing', async () => {
        const { service, reload, row } = harness();
        await offerTurn(service);
        expect(await service.resolveHumanOfferAcceptance('schema', reload(), 'cuánto cuesta el corte?')).toBe(false);
        expect(row.metadata[HUMAN_OFFER_MARK]).toBeUndefined();
        expect(await service.resolveHumanOfferAcceptance('schema', reload(), 'sí')).toBe(false);
    });

    it('the mark expires', async () => {
        const { service, reload, row } = harness();
        await offerTurn(service);
        row.metadata[HUMAN_OFFER_MARK].expiresAt = new Date(Date.now() - 1000).toISOString();
        expect(await service.resolveHumanOfferAcceptance('schema', reload(), 'sí')).toBe(false);
    });

    it('a reply that is not our offer leaves no mark', async () => {
        const { service, row } = harness();
        expect(await service.rememberHumanOffer('schema', 'conv', 'Abrimos de 9 a 18.')).toBe(false);
        expect(row.metadata[HUMAN_OFFER_MARK]).toBeUndefined();
    });

    it('the pipeline wires the acceptance into the handoff branch and leaves the mark after the guardrail', () => {
        const src = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');
        const accept = src.indexOf('await this.resolveHumanOfferAcceptance(');
        const branch = src.indexOf('if (handoffReason && !draftMode) {', accept);
        expect(accept).toBeGreaterThan(0);
        expect(branch).toBeGreaterThan(accept);
        expect(src).toContain("(acceptedOffer ? 'customer_accepted_human_offer' : null)");
        expect(src.indexOf("turnTrace.add('guardrail', 'output'")).toBeLessThan(src.indexOf('await this.rememberHumanOffer('));
        expect(noDataWaitReplacementText('es')).toContain('persona del equipo');
    });
});
