import {
    HUMAN_OFFER_QUESTION, NO_DATA_WAIT_REPLACEMENT, containsHumanOffer, isHumanOfferText, noDataWaitReplacementText,
} from './human-offer';
import { offersHumanHandoff } from '../../common/utils/outcome-claim.util';

/**
 * The offer of a person is worded with «usted» now. A conversation that was offered a person a
 * minute before a deploy carries the old wording in its history, and its customer's «sí» must still
 * be read as accepting that offer: every detector keeps recognising both.
 */
describe('the offer of a person, in usted, and still recognised in its old words', () => {
    const OLD_QUESTION = '¿Quieres que le pida a una persona del equipo que lo confirme?';
    const OLD_NO_DATA = `No tengo ese dato confirmado en este momento. ${OLD_QUESTION}`;

    it('speaks with usted', () => {
        expect(HUMAN_OFFER_QUESTION.es).toBe('¿Quiere que le pida a una persona del equipo que lo confirme?');
        expect(NO_DATA_WAIT_REPLACEMENT.es).toBe(
            'No tengo ese dato confirmado en este momento. ¿Quiere que le pida a una persona del equipo que lo confirme?');
        expect(noDataWaitReplacementText('es')).toBe(NO_DATA_WAIT_REPLACEMENT.es);
    });

    it('containsHumanOffer reads the new and the old question, in a longer message too', () => {
        expect(containsHumanOffer(HUMAN_OFFER_QUESTION.es)).toBe(true);
        expect(containsHumanOffer(`Abrimos a las 9. ${OLD_QUESTION}`)).toBe(true);
        expect(containsHumanOffer('Abrimos a las 9.')).toBe(false);
    });

    it('isHumanOfferText reads the new and the old whole text', () => {
        expect(isHumanOfferText(NO_DATA_WAIT_REPLACEMENT.es)).toBe(true);
        expect(isHumanOfferText(OLD_NO_DATA)).toBe(true);
        expect(isHumanOfferText(`  ${OLD_NO_DATA}  `)).toBe(true);
        expect(isHumanOfferText('No tengo ese dato confirmado en este momento.')).toBe(false);
    });

    it('the regex detector of offers reads both, in the four languages', () => {
        for (const text of [HUMAN_OFFER_QUESTION.es, OLD_QUESTION, NO_DATA_WAIT_REPLACEMENT.es, OLD_NO_DATA,
            HUMAN_OFFER_QUESTION.en, HUMAN_OFFER_QUESTION.pt, HUMAN_OFFER_QUESTION.fr]) {
            expect(offersHumanHandoff(text)).toBe(true);
        }
    });
});
