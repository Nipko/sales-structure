import 'reflect-metadata';
import { validate } from 'class-validator';
import { MapChannelManagerListingDto, UpdateChannelManagerConfigDto } from './channel-manager.dto';

describe('Channel Manager DTO boundary', () => {
    it('rejects arbitrary providers and unsafe sync intervals', async () => {
        const dto = Object.assign(new UpdateChannelManagerConfigDto(), {
            provider: 'invented',
            syncInterval: 1,
        });
        const errors = await validate(dto);
        expect(errors.map(error => error.property)).toEqual(
            expect.arrayContaining(['provider', 'syncInterval']),
        );
    });

    it('requires UUID mapping identities while allowing an explicit unmap', async () => {
        const invalid = Object.assign(new MapChannelManagerListingDto(), {
            listingId: 'not-a-uuid', propertyId: 'also-not-a-uuid',
        });
        expect((await validate(invalid)).map(error => error.property)).toEqual(
            expect.arrayContaining(['listingId', 'propertyId']),
        );

        const unmap = Object.assign(new MapChannelManagerListingDto(), {
            listingId: '11111111-1111-4111-8111-111111111111', propertyId: null,
        });
        await expect(validate(unmap)).resolves.toEqual([]);
    });
});
