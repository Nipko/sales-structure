import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { ChannelManagementController } from '../../channels/channel-management.controller';
import { WhatsappController } from '../whatsapp.controller';

/**
 * ═══ WHICH HANDLER ANSWERS GET /api/v1/channels/whatsapp/status ═══
 *
 * Two controllers declare a route that matches it:
 *
 *   · `ChannelManagementController` — `@Controller('channels')` +
 *     `@Get(':channelType/status')` — answers
 *     `{ success, data: { connected, account, accounts, tokenExpiresAt } }`
 *     from ACTIVE `channel_accounts` rows;
 *   · `WhatsappController` — `@Controller('channels/whatsapp')` +
 *     `@Get('status')` — answers `{ status, channel, channels }` from
 *     `whatsapp_channels` (`WhatsappConnectionService.getChannelStatus`).
 *
 * Express serves the FIRST layer that matches, and Nest registers routes module
 * by module in the order the scanner discovered them. `ChannelsModule` is
 * reached before `WhatsappModule` (it imports it), so the generic handler wins
 * and the WhatsApp-specific one is never reached on this path. A fix made in
 * `getChannelStatus` does not change what the dashboard reads here, and a
 * change to the import graph that flips the order would silently change the
 * body shape three dashboard screens parse (`whatsapp-channel-rows.ts` reads
 * both shapes for exactly this reason).
 *
 * This pins the order against the REAL AppModule. The router is registered on
 * its own — `routesResolver.resolve`, the step `NestApplication.init` runs
 * before any lifecycle hook — so no database, Redis or queue is touched: `init`
 * itself would run every `onModuleInit`, and the question is only which layer
 * Express would pick.
 */
jest.setTimeout(60_000);

const PREFIX = '/api/v1';

describe('GET /api/v1/channels/whatsapp/status is served by the generic channel handler', () => {
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousEncryptionKey = process.env.ENCRYPTION_KEY;
  let moduleRef: TestingModule;
  let app: INestApplication;
  let getLayers: any[];

  beforeAll(async () => {
    // The same environment the bootstrap contract (app.bootstrap.spec.ts) uses.
    process.env.JWT_SECRET = 'bootstrap-test-only-jwt-secret-at-least-32-bytes';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix(PREFIX.slice(1)); // as main.ts does
    (app as any).routesResolver.resolve(app.getHttpAdapter(), PREFIX);
    getLayers = app.getHttpAdapter().getInstance()._router.stack
      .filter((layer: any) => layer.route?.methods?.get);
  });

  afterAll(async () => {
    await moduleRef?.close();
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousEncryptionKey;
  });

  /** Every registered GET path that Express would match for `url`, in dispatch order. */
  const matchingPaths = (url: string): string[] => getLayers
    .filter((layer: any) => layer.match(url))
    .map((layer: any) => String(layer.route.path));

  /** The full path a controller method is mounted at, read from its own decorators. */
  const mountedPath = (controller: any, method: string): string => {
    const handler = controller.prototype[method];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    return `${PREFIX}/${Reflect.getMetadata(PATH_METADATA, controller)}/${Reflect.getMetadata(PATH_METADATA, handler)}`;
  };

  it('dispatches the status request to ChannelManagementController.getStatus, ahead of WhatsappController.getStatus', () => {
    const generic = mountedPath(ChannelManagementController, 'getStatus');
    const specific = mountedPath(WhatsappController, 'getStatus');
    expect(generic).toBe('/api/v1/channels/:channelType/status');
    expect(specific).toBe('/api/v1/channels/whatsapp/status');

    // The first entry is the one that answers; the second is shadowed.
    expect(matchingPaths('/api/v1/channels/whatsapp/status')).toEqual([generic, specific]);
  });

  it('shadows WhatsappController.getConfig the same way', () => {
    const generic = mountedPath(ChannelManagementController, 'getConfig');
    const specific = mountedPath(WhatsappController, 'getConfig');

    expect(matchingPaths('/api/v1/channels/whatsapp/config')).toEqual([generic, specific]);
  });
});
