import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { VehicleInventoryController } from './vehicle-inventory.controller';

describe('VehicleInventoryController route precedence', () => {
    it('registers the static search route before the dynamic vehicle route', () => {
        const routes = Object.getOwnPropertyNames(VehicleInventoryController.prototype)
            .map((method) => {
                const handler = (VehicleInventoryController.prototype as any)[method];
                return {
                    method,
                    path: Reflect.getMetadata(PATH_METADATA, handler),
                    requestMethod: Reflect.getMetadata(METHOD_METADATA, handler),
                };
            })
            .filter((route) => route.requestMethod === RequestMethod.GET);

        const searchIndex = routes.findIndex((route) => route.path === ':tenantId/search');
        const vehicleIndex = routes.findIndex((route) => route.path === ':tenantId/:vehicleId');

        expect(searchIndex).toBeGreaterThanOrEqual(0);
        expect(vehicleIndex).toBeGreaterThanOrEqual(0);
        expect(searchIndex).toBeLessThan(vehicleIndex);
    });
});
