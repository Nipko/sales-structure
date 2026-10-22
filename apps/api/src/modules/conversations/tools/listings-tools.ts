/**
 * Real Estate Listings tools — let the agent show real listings to the
 * customer instead of asking the human team for the catalog.
 * Registered when config.tools.realEstate.enabled === true.
 */
import { ToolDefinition } from '@parallext/shared';

export const LISTINGS_TOOLS: ToolDefinition[] = [
    {
        name: 'search_listings',
        description: 'Search the agency\'s real estate catalog. Use it AS SOON AS the customer gives any criteria (operation, neighborhood, bedrooms, kind, price): every parameter is optional and the budget is optional — do not ask for it before searching. An empty result is an answer: say nothing matched and offer to adjust. `catalog_empty: true` is a different answer: the agency has not published any listing yet, so say that plainly (never that you cannot search) and offer that an advisor contacts them. Returns listings with price, area, bedrooms, neighborhood and a status flag (only available listings are returned by default).',
        parameters: {
            type: 'object',
            properties: {
                transactionType: {
                    type: 'string',
                    enum: ['sale', 'rent'],
                    description: 'sale = buy (compra, venta), rent = arriendo / alquiler / alugar. Read it from the message; ask only if the customer really did not say.',
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
        description: 'Send the customer the current published photos of a specific listing (up to 3). Call when the customer asks to receive a photo, including a new request after an earlier send: a previous result is not a send in this turn. The tool reads the current catalogue images. Use only a listingId returned by search_listings. The images are sent for you: do not substitute links, descriptions or a visit, or claim the channel cannot send images while this tool is available. Report success only from the current tool result; report missing images, errors or pending review honestly.',
        parameters: {
            type: 'object',
            properties: {
                listingId: { type: 'string', description: 'Listing UUID returned by search_listings' },
            },
            required: ['listingId'],
        },
    },
];
