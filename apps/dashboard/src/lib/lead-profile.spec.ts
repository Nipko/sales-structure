import { interpretLeadProfile } from "./lead-profile";

const LEAD = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const lead = { id: LEAD, contact_id: CONTACT };

describe("interpretLeadProfile", () => {
    it("a lead opened by its own id is editable", () => {
        expect(interpretLeadProfile(LEAD, { lead, resolved: { kind: "lead", leadId: LEAD, contactId: CONTACT } }))
            .toEqual({ mode: "editable", leadId: LEAD });
    });

    it("a contact id that resolves to a lead redirects to the lead's URL", () => {
        expect(interpretLeadProfile(CONTACT, { lead, resolved: { kind: "contact_lead", leadId: LEAD, contactId: CONTACT } }))
            .toEqual({ mode: "redirect", leadId: LEAD });
    });

    it("a contact with no lead is read-only", () => {
        const data = { lead: { id: null, contact_id: CONTACT }, resolved: { kind: "contact_only", leadId: null, contactId: CONTACT } };
        expect(interpretLeadProfile(CONTACT, data)).toEqual({ mode: "read_only", contactId: CONTACT });
    });

    it("an API that predates `resolved` is read as the lead the URL named", () => {
        expect(interpretLeadProfile(LEAD, { lead })).toEqual({ mode: "editable", leadId: LEAD });
    });

    it("never edits with an id that is not the lead's, even without `resolved`", () => {
        expect(interpretLeadProfile(CONTACT, { lead })).toEqual({ mode: "redirect", leadId: LEAD });
    });

    it.each([null, undefined, {}, { lead: null }, { lead: "x" }, { lead: {} }])("%j is invalid, not a blank screen", (data) => {
        expect(interpretLeadProfile(LEAD, data)).toEqual({ mode: "invalid" });
    });
});
