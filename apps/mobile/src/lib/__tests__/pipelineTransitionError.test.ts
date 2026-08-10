import { describePipelineMoveError } from '../pipelineTransitionError';

describe('describePipelineMoveError', () => {
    it.each([
        ['food_order_required', 'pipeline.ruleFoodOrder'],
        ['photo_session_scheduled_required', 'pipeline.rulePhotoSessionScheduled'],
        ['pet_boarding_required', 'pipeline.rulePetBoarding'],
        ['vehicle_rental_required', 'pipeline.ruleVehicleRental'],
        ['tour_booking_required', 'pipeline.ruleTourBooking'],
        ['property_booking_required', 'pipeline.rulePropertyBooking'],
        ['service_request_scheduled_required', 'pipeline.ruleServiceRequestScheduled'],
    ])('maps %s to its localized message key', (rule, key) => {
        expect(describePipelineMoveError(`Bad Request: TRANSITION_RULE_FAILED:${rule}`)).toEqual({ key });
    });

    it('extracts Nest-style nested error envelopes without exposing the raw contract', () => {
        const descriptor = describePipelineMoveError({
            message: 'TRANSITION_RULE_FAILED:food_order_required',
            error: 'Bad Request',
        });
        expect(descriptor).toEqual({ key: 'pipeline.ruleFoodOrder' });
        expect(JSON.stringify(descriptor)).not.toContain('TRANSITION_RULE_FAILED');
    });

    it('keeps parameterized rules localized', () => {
        expect(describePipelineMoveError('TRANSITION_RULE_FAILED:min_score:75')).toEqual({
            key: 'pipeline.ruleScore',
            params: { score: '75' },
        });
        expect(describePipelineMoveError('TRANSITION_RULE_FAILED:custom_attribute_equals:city:Bogota')).toEqual({
            key: 'pipeline.ruleCustomEquals',
            params: { field: 'city', value: 'Bogota' },
        });
    });

    it('uses safe localized fallbacks for unknown rule and non-rule errors', () => {
        expect(describePipelineMoveError('TRANSITION_RULE_FAILED:future_rule')).toEqual({
            key: 'pipeline.ruleGeneric',
        });
        expect(describePipelineMoveError('database unavailable')).toEqual({
            key: 'pipeline.moveError',
        });
    });
});
