import { LlmKeyService } from '../settings/llm-key.service';
import { FeatureRequestsService } from './feature-requests.service';

describe('FeatureRequestsService OpenAI key resolution', () => {
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

    beforeEach(() => {
        delete process.env.OPENAI_API_KEY;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalOpenAiApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalOpenAiApiKey;
        }
    });

    function createHarness(platformSettings: Array<{ key: string; value: string }>) {
        const keyPrisma = {
            $queryRaw: jest.fn().mockResolvedValue(platformSettings),
        };
        const redis = {
            del: jest.fn().mockResolvedValue(1),
        };
        const llmKeys = new LlmKeyService(keyPrisma as any, redis as any);
        const prisma = {
            $queryRawUnsafe: jest.fn(),
        };
        const config = {
            get: jest.fn(),
        };
        const service = new FeatureRequestsService(
            prisma as any,
            config as any,
            { send: jest.fn() } as any,
            { runExclusive: jest.fn() } as any,
            llmKeys,
        );

        return { service, prisma, config, keyPrisma };
    }

    it('builds the OpenAI client from the key stored in platform_settings without an env key', async () => {
        const { service, config, keyPrisma } = createHarness([
            { key: 'llm.openai_api_key', value: 'sk-platform-settings-openai' },
        ]);

        const client = await (service as any).ensureOpenAI();

        expect((client as any).apiKey).toBe('sk-platform-settings-openai');
        expect(keyPrisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(config.get).not.toHaveBeenCalledWith('OPENAI_API_KEY');
        expect(process.env.OPENAI_API_KEY).toBeUndefined();
    });

    it('skips embedding when platform_settings has no OpenAI key and the env key is absent', async () => {
        const { service, prisma, config, keyPrisma } = createHarness([]);
        const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

        const embedding = await (service as any).embed('Feature request without a configured provider key');

        expect(embedding).toBeNull();
        expect((service as any).openai).toBeNull();
        expect(keyPrisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        expect(config.get).not.toHaveBeenCalledWith('OPENAI_API_KEY');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('platform settings'));
        expect(process.env.OPENAI_API_KEY).toBeUndefined();
    });
});
