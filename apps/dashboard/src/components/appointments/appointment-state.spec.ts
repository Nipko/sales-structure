import {
  appointmentConversationHref,
  appointmentQueryWindow,
  appointmentsInWeek,
  canRescheduleAppointment,
  isAiCreatedAppointment,
  isCancelledAppointment,
  isCurrentWeek,
  weekKpis,
  type Appointment,
} from "./shared";

function appt(over: Partial<Appointment> & { id: string; startAt: string }): Appointment {
  return {
    serviceName: "Corte y estilo",
    endAt: over.startAt,
    status: "confirmed",
    createdAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("which appointments can be moved", () => {
  it("only pending and confirmed bookings are movable", () => {
    expect(canRescheduleAppointment({ status: "pending" })).toBe(true);
    expect(canRescheduleAppointment({ status: "confirmed" })).toBe(true);
    for (const status of ["cancelled", "completed", "no_show"] as const) {
      expect(canRescheduleAppointment({ status })).toBe(false);
    }
  });

  it("recognises a cancelled appointment", () => {
    expect(isCancelledAppointment({ status: "cancelled" })).toBe(true);
    expect(isCancelledAppointment({ status: "confirmed" })).toBe(false);
  });
});

describe("the window of appointments that is requested", () => {
  const monday = new Date(2026, 9, 12); // Mon 12 Oct 2026
  const today = new Date(2026, 9, 8);

  it("asks the calendar for the whole visible week, through the last second of Sunday", () => {
    expect(appointmentQueryWindow("calendar", monday, today)).toEqual({
      startDate: "2026-10-12",
      // A bare date meant midnight at the START of Sunday and dropped its bookings.
      endDate: "2026-10-18T23:59:59",
    });
  });

  it("asks the agenda for a month back and half a year ahead, whatever week the calendar shows", () => {
    expect(appointmentQueryWindow("agenda", monday, today)).toEqual({
      startDate: "2026-09-08",
      endDate: "2027-04-06T23:59:59",
    });
    expect(appointmentQueryWindow("agenda", new Date(2030, 0, 7), today))
      .toEqual(appointmentQueryWindow("agenda", monday, today));
  });
});

describe("the counters for the shown week", () => {
  const list = [
    appt({ id: "a", startAt: "2026-10-12T09:00:00", status: "cancelled" }),
    appt({ id: "b", startAt: "2026-10-13T09:00:00", status: "cancelled" }),
    appt({ id: "c", startAt: "2026-10-18T10:00:00", status: "pending" }),
    appt({ id: "d", startAt: "2026-10-19T10:00:00", status: "confirmed" }),
    appt({ id: "e", startAt: "2026-10-07T10:00:00", status: "confirmed" }),
  ];

  it("counts only the appointments of the week that starts at weekStart", () => {
    const inWeek = appointmentsInWeek(list, new Date(2026, 9, 12));
    expect(inWeek.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(weekKpis(inWeek)).toEqual({ total: 3, pending: 1, confirmed: 0, completed: 0, cancelled: 2 });
  });

  it("is zero for a week with nothing, instead of leaking the loaded list", () => {
    expect(weekKpis(appointmentsInWeek(list, new Date(2026, 9, 5))).total).toBe(1);
    expect(weekKpis(appointmentsInWeek(list, new Date(2027, 0, 4))).total).toBe(0);
  });

  it("knows whether the shown week is the current one", () => {
    expect(isCurrentWeek(new Date(2026, 9, 5), new Date(2026, 9, 8))).toBe(true);
    expect(isCurrentWeek(new Date(2026, 9, 12), new Date(2026, 9, 8))).toBe(false);
  });
});

describe("where an appointment came from", () => {
  it("flags the ones the assistant booked and links their conversation", () => {
    expect(isAiCreatedAppointment({ source: "ai" })).toBe(true);
    expect(isAiCreatedAppointment({ source: "manual" })).toBe(false);
    expect(isAiCreatedAppointment({})).toBe(false);
    expect(appointmentConversationHref({ conversationId: "c-1" })).toBe("/admin/inbox?conversation=c-1");
    expect(appointmentConversationHref({ conversationId: null })).toBeNull();
  });
});
