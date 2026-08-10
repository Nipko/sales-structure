import { BadRequestException } from '@nestjs/common';
import {
    normalizeCurrencyCode,
    optionalPositiveIntegerUnit,
    requirePositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import { EducationService } from '../education/education.service';
import { GymsService } from '../gyms/gyms.service';
import { HomeServicesService } from '../home-services/home-services.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { PhotographyService } from '../photography/photography.service';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { ToursService } from '../tours/tours.service';

describe('commercial unit validators', () => {
    it('normalizes configured currency without selecting or converting it', () => {
        expect(normalizeCurrencyCode(' mxn ')).toBe('MXN');
        expect(normalizeCurrencyCode(undefined)).toBe('COP');
        expect(() => normalizeCurrencyCode('peso')).toThrow(BadRequestException);
    });

    it('accepts only positive integer duration units while preserving unknown as null', () => {
        expect(requirePositiveIntegerUnit('45', 'durationMinutes')).toBe(45);
        expect(optionalPositiveIntegerUnit(undefined, 'durationMinutes')).toBeNull();
        expect(optionalPositiveIntegerUnit(null, 'durationMinutes')).toBeNull();
        expect(() => requirePositiveIntegerUnit(0, 'durationMinutes')).toThrow(BadRequestException);
        expect(() => requirePositiveIntegerUnit(-1, 'durationMinutes')).toThrow(BadRequestException);
        expect(() => requirePositiveIntegerUnit(1.5, 'durationMinutes')).toThrow(BadRequestException);
    });
});

describe('unit-specific vertical writers', () => {
    it('persists tour duration as an explicit hours/days pair and preserves currency', async () => {
        const prisma = {
            executeInTenantSchema: jest.fn()
                .mockResolvedValueOnce([{ cnt: 0 }])
                .mockResolvedValueOnce([{ id: 'tour-1' }]),
        };
        const throttle = { enforcePlanLimit: jest.fn().mockResolvedValue(undefined) };
        const service = new ToursService(prisma as any, throttle as any, {} as any);

        await service.createPackage('tenant-id', 'tenant_schema', {
            name: 'Ruta de tres días',
            durationType: 'days',
            durationValue: '3',
            currency: ' mxn ',
        });

        const params = prisma.executeInTenantSchema.mock.calls[1][2];
        expect(params[2]).toBe('days');
        expect(params[3]).toBe(3);
        expect(params[5]).toBe('MXN');
    });

    it.each([
        ['education hours', () => new EducationService({ executeInTenantSchema: jest.fn() } as any)
            .createCourse('tenant', { name: 'Curso', durationHours: 0 })],
        ['gym plan days', () => new GymsService({ executeInTenantSchema: jest.fn() } as any)
            .createPlan('tenant', { name: 'Plan', durationDays: -30, price: 1 })],
        ['photo session minutes', () => new PhotographyService(
            { executeInTenantSchema: jest.fn() } as any,
            { emit: jest.fn() } as any,
        )
            .create('tenant', { sessionType: 'portrait', durationMinutes: 0 })],
        ['restaurant prep minutes', () => new RestaurantsService(
            { executeInTenantSchema: jest.fn() } as any,
            { emit: jest.fn() } as any,
        )
            .createItem('tenant', { name: 'Plato', price: 1, prepTimeMinutes: -1 })],
    ])('rejects non-positive %s before persistence', async (_label, operation) => {
        await expect(operation()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists home-service estimate duration and its currency instead of dropping currency', async () => {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([{ id: 'request-1' }]) };
        const service = new HomeServicesService(prisma as any, { emit: jest.fn() } as any);

        await service.createRequest('tenant', {
            serviceType: 'plomeria',
            estimatedDurationMinutes: '90',
            estimatedCost: 250,
            currency: 'pen',
        });

        const [sql, params] = [
            prisma.executeInTenantSchema.mock.calls[0][1],
            prisma.executeInTenantSchema.mock.calls[0][2],
        ];
        expect(sql).toContain('estimated_duration_minutes, estimated_cost, currency');
        expect(params[13]).toBe(90);
        expect(params[15]).toBe('PEN');
    });
});

describe('retail currency lineage', () => {
    it('persists the currency supplied with a catalog product', async () => {
        const prisma = {
            $queryRawUnsafe: jest.fn(),
            executeInTenantSchema: jest.fn().mockResolvedValue([{ id: 'product-1' }]),
        };
        const redis = {
            get: jest.fn(async (key: string) => key.startsWith('tenant:') ? 'tenant_schema' : 'true'),
            set: jest.fn(),
        };
        const service = new InventoryService(prisma as any, redis as any);

        await service.createProduct('tenant-id', {
            name: 'Producto', sku: 'SKU-1', price: 100, stock: 2, currency: 'brl',
        });

        const params = prisma.executeInTenantSchema.mock.calls[0][2];
        expect(params[4]).toBe('BRL');
    });

    it('derives an order currency from authoritative product rows', async () => {
        const transactionQuery = jest.fn()
            .mockResolvedValueOnce([{
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                name: 'Producto',
                price: '100',
                currency: 'MXN',
                stock: 2,
                is_available: true,
            }])
            .mockResolvedValueOnce([{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ stock: 1 }])
            .mockResolvedValueOnce([]);
        const prisma = {
            transactionInTenantSchema: jest.fn((_schema, callback) => callback(transactionQuery)),
        };
        const redis = { get: jest.fn().mockResolvedValue('tenant_schema'), set: jest.fn() };
        const service = new OrdersService(prisma as any, redis as any);

        await service.createOrder('tenant-id', {
            items: [{
                productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                productName: 'Producto', quantity: 1, unitPrice: 100,
            }],
        });

        const orderParams = transactionQuery.mock.calls[1][1];
        expect(orderParams[5]).toBe('MXN');
    });

    it('rejects mixed catalog currencies instead of labelling the order COP', async () => {
        const transactionQuery = jest.fn().mockResolvedValueOnce([
            {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                name: 'A', price: '1', currency: 'MXN', stock: 1, is_available: true,
            },
            {
                id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                name: 'B', price: '1', currency: 'COP', stock: 1, is_available: true,
            },
        ]);
        const prisma = {
            transactionInTenantSchema: jest.fn((_schema, callback) => callback(transactionQuery)),
        };
        const redis = { get: jest.fn().mockResolvedValue('tenant_schema'), set: jest.fn() };
        const service = new OrdersService(prisma as any, redis as any);

        await expect(service.createOrder('tenant-id', {
            items: [
                { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', productName: 'A', quantity: 1, unitPrice: 1 },
                { productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', productName: 'B', quantity: 1, unitPrice: 1 },
            ],
        })).rejects.toThrow('All order items must use the same currency');
        expect(transactionQuery).toHaveBeenCalledTimes(1);
    });
});
