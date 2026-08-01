/**
 * Real Estate Listings tools — let the agent show real listings to the
 * customer instead of asking the human team for the catalog.
 * Registered when config.tools.realEstate.enabled === true.
 */
import { ToolDefinition } from '@parallext/shared';

export const LISTINGS_TOOLS: ToolDefinition[] = [
    {
        name: 'search_listings',
        description: 'Search the agency\'s real estate catalog. Use when the customer asks about properties for sale or rent. Returns listings with price, area, bedrooms, neighborhood and a status flag (only available listings are returned by default).',
        parameters: {
            type: 'object',
            properties: {
                transactionType: {
                    type: 'string',
                    enum: ['sale', 'rent'],
                    description: 'Whether the customer wants to buy (sale) or rent. Always ask if unclear.',
                },
                propertyKind: {
                    type: 'string',
                    enum: ['apartment', 'house', 'commercial', 'land', 'office'],
                    description: 'Property type — apartment, house, commercial, land, office',
                },
                maxPrice: {
                    type: 'number',
                    description: 'Maximum budget in the local currency (for rent: per month)',
                },
                minBedrooms: {
                    type: 'number',
                    description: 'Minimum number of bedrooms required',
                },
                neighborhood: {
                    type: 'string',
                    description: 'Neighborhood / barrio of interest. Partial match — "Chapinero" matches "Chapinero Alto"',
                },
                city: {
                    type: 'string',
                    description: 'City of interest',
                },
                minAreaM2: {
                    type: 'number',
                    description: 'Minimum area in square meters',
                },
            },
        },
    },
    {
        name: 'get_listing_details',
        description: 'Get full details of a listing including amenities, description, address and external listing URL. Use after the customer expresses interest in a specific property from search_listings.',
        parameters: {
            type: 'object',
            properties: {
                listingId: { type: 'string', description: 'Listing UUID returned by search_listings' },
            },
            required: ['listingId'],
        },
    },
    {
        name: 'send_listing_image',
        description: 'Send the customer real photos of a specific listing (up to 3). Use when showing/recommending a property would benefit from a visual — a buyer decides on the facade AND the kitchen, not one thumbnail. Only call with a listingId you got from search_listings. The images are sent for you: do not paste links or describe them in your reply.',
        parameters: {
            type: 'object',
            properties: {
                listingId: { type: 'string', description: 'Listing UUID returned by search_listings' },
            },
            required: ['listingId'],
        },
    },
];
