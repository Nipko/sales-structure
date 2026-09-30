import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService SMTP outcomes', () => {
    const payload = { to: 'user@example.com', subject: 'Notice', text: 'Body' };
    function service(sendMail?: jest.Mock) {
        const instance = new EmailService({ get: jest.fn(() => undefined) } as unknown as ConfigService);
        if (sendMail) (instance as any).transporter = { sendMail };
        return instance;
    }

    function bounded(send: jest.Mock) {
        const instance = service();
        jest.spyOn(instance, 'prepareBoundedSend').mockReturnValue(send);
        return instance;
    }

    it('reports disabled SMTP as failed', async () => {
        await expect(service().sendWithOutcome(payload)).resolves.toEqual({ status: 'failed' });
    });

    it('only reports accepted after the bounded transport returns a receipt', async () => {
        const instance = bounded(jest.fn().mockResolvedValue('<receipt@example.invalid>'));
        await expect(instance.sendWithOutcome(payload)).resolves.toEqual({ status: 'accepted' });
        expect(instance.prepareBoundedSend).toHaveBeenCalledWith(payload);
        await expect(bounded(jest.fn().mockResolvedValue('')).sendWithOutcome(payload)).resolves.toEqual({ status: 'unknown' });
    });

    it.each([{ responseCode: 550, command: 'DATA' }, { code: 'EAUTH' }, { code: 'EDNS', command: 'CONN' }])('classifies an explicit rejection or pre-DATA failure as failed', async (error) => {
        await expect(bounded(jest.fn().mockRejectedValue(error)).sendWithOutcome(payload)).resolves.toEqual({ status: 'failed' });
    });

    it('preserves ambiguous acceptance after DATA as unknown', async () => {
        await expect(bounded(jest.fn().mockRejectedValue(new Error('smtp_deadline_outcome_unknown'))).sendWithOutcome(payload)).resolves.toEqual({ status: 'unknown' });
    });

    it('does not treat Nodemailer CONN as proof that DATA was never sent', async () => {
        await expect(bounded(jest.fn().mockRejectedValue({ code: 'ECONNECTION', command: 'CONN' })).sendWithOutcome(payload)).resolves.toEqual({ status: 'unknown' });
    });

    it('keeps the legacy boolean API for other callers', async () => {
        await expect(service(jest.fn().mockResolvedValue({ accepted: [payload.to] })).send(payload)).resolves.toBe(true);
        await expect(service().send(payload)).resolves.toBe(false);
    });
});
