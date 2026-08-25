import { BadRequestException } from '@nestjs/common';
import { CERTIFIED_SELF_SERVICE_CHANNELS } from '@parallext/shared';
import { PersonaService } from './persona.service';

describe('Agent self-service channel assignments', () => {
    const service = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);

    it('accepts every certified conversational surface', () => {
        expect(() => (service as any).assertSelfServiceAssignments([...CERTIFIED_SELF_SERVICE_CHANNELS], ['whatsapp:account-1']))
            .not.toThrow();
    });

    it.each(['sms', 'email'])('rejects retired/internal %s assignments and bindings', (channel) => {
        expect(() => (service as any).assertSelfServiceAssignments([channel], [])).toThrow(BadRequestException);
        expect(() => (service as any).assertSelfServiceAssignments([], [`${channel}:account`])).toThrow(BadRequestException);
    });
});
