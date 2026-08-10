export interface AppointmentContact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

export function hasAppointmentContact(
  contactId: string,
  contacts: readonly AppointmentContact[],
): boolean {
  return contactId.length > 0 && contacts.some((contact) => contact.id === contactId);
}

export function canSaveAppointmentWithContact(
  isEditing: boolean,
  contactId: string,
  contacts: readonly AppointmentContact[],
): boolean {
  return isEditing || hasAppointmentContact(contactId, contacts);
}
