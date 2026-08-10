import {
  canSaveAppointmentWithContact,
  hasAppointmentContact,
  type AppointmentContact,
} from "./contact-selection";

const contacts: AppointmentContact[] = [
  { id: "contact-1", name: "Ada Lovelace", phone: "+573001112233" },
];

describe("appointment contact selection", () => {
  it("accepts only a contact returned by the tenant CRM list", () => {
    expect(hasAppointmentContact("contact-1", contacts)).toBe(true);
    expect(hasAppointmentContact("", contacts)).toBe(false);
    expect(hasAppointmentContact("contact-from-another-tenant", contacts)).toBe(false);
  });

  it("requires a CRM contact for every new manual appointment", () => {
    expect(canSaveAppointmentWithContact(false, "contact-1", contacts)).toBe(true);
    expect(canSaveAppointmentWithContact(false, "", contacts)).toBe(false);
    expect(canSaveAppointmentWithContact(false, "unknown", contacts)).toBe(false);
  });

  it("allows an existing legacy appointment to keep an empty or unavailable contact", () => {
    expect(canSaveAppointmentWithContact(true, "", contacts)).toBe(true);
    expect(canSaveAppointmentWithContact(true, "legacy-contact", contacts)).toBe(true);
  });
});
