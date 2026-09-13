import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'conversations.service.ts'), 'utf8');
const outbox = fs.readFileSync(path.join(__dirname, '..', 'channels', 'agent-dispatch-outbox.ts'), 'utf8');

describe('conversation media delivery idempotency contract', () => {
    it('commits every attachment in the inbound-owned durable batch', () => {
        expect(source).toContain('effectSink.media.push({');
        expect(source).toContain('const items = buildDispatchItems({');
        expect(source).toContain('binding, items,');
        expect(source).toContain('findBatchForInbound(tenantId, input.schemaName, binding)');
    });

    it('writes media and payment-link history with the same deterministic item identity', () => {
        expect(outbox).toContain('const externalId = `out:dispatch:${input.binding.inboundMessageId}:${index}`');
        expect(outbox).toContain('const content = historyContent(item)');
        expect(outbox).toContain('ON CONFLICT ("external_id") WHERE "external_id" IS NOT NULL DO NOTHING');
    });
});
