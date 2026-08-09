import { of } from 'rxjs';
import { MetaGraphService } from './meta-graph.service';

describe('MetaGraphService', () => {
  it('retains the parent Business Portfolio ID while flattening WABAs', async () => {
    const httpService = {
      get: jest.fn().mockReturnValue(of({
        data: {
          data: [
            {
              id: 'business-1',
              name: 'Portfolio One',
              owned_whatsapp_business_accounts: {
                data: [
                  {
                    id: 'waba-1',
                    name: 'WABA One',
                    currency: 'COP',
                    timezone_id: '5',
                    message_template_namespace: 'namespace-1',
                  },
                ],
              },
            },
          ],
        },
      })),
    };
    const config = {
      get: jest.fn((key: string) => ({
        'meta.graphVersion': 'v25.0',
        'meta.graphBaseUrl': 'https://graph.facebook.com',
        'meta.discoveryTimeout': 10000,
      })[key]),
    };
    const service = new MetaGraphService(httpService as any, config as any);

    await expect(service.getBusinessAccountsForToken('token')).resolves.toEqual([
      expect.objectContaining({
        id: 'waba-1',
        name: 'WABA One',
        businessId: 'business-1',
        businessName: 'Portfolio One',
      }),
    ]);
    expect(httpService.get).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/me/businesses',
      expect.objectContaining({
        params: expect.objectContaining({
          access_token: 'token',
          fields: expect.stringContaining('owned_whatsapp_business_accounts'),
        }),
      }),
    );
  });
});
