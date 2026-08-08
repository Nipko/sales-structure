export interface VerticalAnalyticsFixture {
    industry: string;
    queryRows: Array<{ includes: string; rows: any[] }>;
    expectedStats: Record<string, number>;
}

/**
 * Semantic fixtures use the exact column aliases emitted by PostgreSQL. They
 * intentionally model business outcomes (repeat customers, paid orders,
 * weighted pipeline), not implementation call order.
 */
export const VERTICAL_ANALYTICS_FIXTURES: VerticalAnalyticsFixture[] = [
    {
        industry: 'moda_belleza',
        queryRows: [
            { includes: 'FROM services', rows: [{ cnt: 5 }] },
            {
                includes: 'FROM appointments',
                rows: [{
                    appointments_30d: 20,
                    completed_30d: 14,
                    no_shows_30d: 2,
                    upcoming_7d: 6,
                    customers_30d: 10,
                    repeat_customers_30d: 4,
                }],
            },
        ],
        expectedStats: {
            activeServices: 5,
            appointments30d: 20,
            completedAppointments30d: 14,
            noShows30d: 2,
            appointmentsNext7d: 6,
            uniqueCustomers30d: 10,
            repeatCustomers30d: 4,
            repeatCustomerRatePct: 40,
        },
    },
    {
        industry: 'automotriz',
        queryRows: [
            {
                includes: 'FROM vehicles',
                rows: [{
                    total: 25,
                    available: 14,
                    reserved: 3,
                    maintenance: 2,
                    sold_this_month: 6,
                    sold_revenue_cents_month: '48000000000',
                    avg_available_price_cents: '8200000000',
                }],
            },
            {
                includes: "metadata->>'vehicleId'",
                rows: [{ this_month: 8, next_7d: 3 }],
            },
        ],
        expectedStats: {
            vehiclesTotal: 25,
            vehiclesAvailable: 14,
            vehiclesReserved: 3,
            vehiclesMaintenance: 2,
            vehiclesSoldThisMonth: 6,
            soldRevenueCentsThisMonth: 48000000000,
            avgAvailablePriceCents: 8200000000,
            testDrivesThisMonth: 8,
            testDrivesNext7d: 3,
        },
    },
    {
        industry: 'finanzas',
        queryRows: [
            {
                includes: 'FROM opportunities',
                rows: [{
                    open_applications: 9,
                    applications_30d: 12,
                    approved_30d: 6,
                    rejected_30d: 2,
                    open_estimated_value: '250000000',
                }],
            },
            { includes: 'FROM appointments', rows: [{ cnt: 4 }] },
        ],
        expectedStats: {
            applicationsOpen: 9,
            applications30d: 12,
            applicationsApproved30d: 6,
            applicationsRejected30d: 2,
            approvalRatePct: 75,
            openEstimatedValue: 250000000,
            consultationsNext7d: 4,
        },
    },
    {
        industry: 'servicios_profesionales',
        queryRows: [
            {
                includes: 'FROM deals',
                rows: [{
                    open_deals: 7,
                    won_30d: 3,
                    lost_30d: 1,
                    pipeline_value: '180000000',
                    weighted_pipeline_value: '99000000',
                }],
            },
            { includes: 'FROM appointments', rows: [{ next_7d: 5, completed_30d: 11 }] },
        ],
        expectedStats: {
            openDeals: 7,
            wonDeals30d: 3,
            lostDeals30d: 1,
            winRate30d: 75,
            pipelineValue: 180000000,
            weightedPipelineValue: 99000000,
            consultationsNext7d: 5,
            consultationsCompleted30d: 11,
        },
    },
    {
        industry: 'retail',
        queryRows: [
            {
                includes: 'FROM products',
                rows: [{ total: 80, available: 70, out_of_stock: 6, stock_units: '420' }],
            },
            {
                includes: 'FROM orders',
                rows: [{ orders_30d: 20, paid_orders_30d: 14, pending_orders_30d: 4, gmv_30d: '3000000' }],
            },
        ],
        expectedStats: {
            productsTotal: 80,
            productsAvailable: 70,
            productsOutOfStock: 6,
            stockUnits: 420,
            orders30d: 20,
            paidOrders30d: 14,
            pendingOrders30d: 4,
            gmv30d: 3000000,
            averageOrderValue30d: 150000,
        },
    },
    {
        industry: 'technology',
        queryRows: [
            { includes: 'FROM companies', rows: [{ cnt: 12 }] },
            {
                includes: 'FROM deals',
                rows: [{
                    open_deals: 8,
                    won_30d: 4,
                    lost_30d: 2,
                    pipeline_value: '900000000',
                    weighted_pipeline_value: '540000000',
                }],
            },
            { includes: 'FROM opportunities', rows: [{ avg_days: '18.46' }] },
            { includes: 'FROM appointments', rows: [{ cnt: 7 }] },
        ],
        expectedStats: {
            companies: 12,
            openDeals: 8,
            wonDeals30d: 4,
            lostDeals30d: 2,
            winRate30d: 67,
            pipelineValue: 900000000,
            weightedPipelineValue: 540000000,
            avgSalesCycleDays30d: 18.5,
            demosNext7d: 7,
        },
    },
    {
        industry: 'pet_services',
        queryRows: [
            { includes: 'FROM pets', rows: [{ cnt: 30 }] },
            { includes: 'FROM services', rows: [{ cnt: 6 }] },
            {
                includes: 'FROM appointments',
                rows: [{ bookings_30d: 24, completed_30d: 18, no_shows_30d: 2, next_7d: 9, pets_served_30d: 16 }],
            },
        ],
        expectedStats: {
            pets: 30,
            activeServices: 6,
            bookings30d: 24,
            completedBookings30d: 18,
            noShows30d: 2,
            bookingsNext7d: 9,
            petsServed30d: 16,
        },
    },
    {
        industry: 'otro',
        queryRows: [
            { includes: 'FROM contacts', rows: [{ total: 40, new_30d: 12 }] },
            { includes: 'FROM conversations', rows: [{ cnt: 28 }] },
            { includes: 'FROM deals', rows: [{ open_deals: 5, pipeline_value: '70000000' }] },
            { includes: 'FROM products', rows: [{ cnt: 15 }] },
            { includes: 'FROM orders', rows: [{ orders_30d: 9, gmv_30d: '1200000' }] },
        ],
        expectedStats: {
            contactsTotal: 40,
            newContacts30d: 12,
            conversations30d: 28,
            openDeals: 5,
            pipelineValue: 70000000,
            catalogProducts: 15,
            orders30d: 9,
            gmv30d: 1200000,
        },
    },
];
