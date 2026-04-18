"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Calendar, Clock, ChevronLeft, ChevronRight, CheckCircle2,
  Loader2, MapPin, User, Phone, Mail, FileText,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  currency: string;
  color: string;
}

interface Slot {
  start: string;
  end: string;
  display: string;
}

type Step = "services" | "date" | "time" | "info" | "confirmed";

export default function PublicBookingPage() {
  const params = useParams();
  const tenantSlug = params.tenantSlug as string;

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Wizard state
  const [step, setStep] = useState<Step>("services");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [confirmationData, setConfirmationData] = useState<any>(null);

  // Calendar navigation
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Load services
  useEffect(() => {
    if (!tenantSlug) return;
    setLoading(true);
    fetch(`${API_URL}/booking/${tenantSlug}/services`)
      .then(r => r.json())
      .then(res => {
        if (res.success) setServices(res.data || []);
        else setError("Could not load services");
      })
      .catch(() => setError("Connection error"))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  // Load slots when date changes
  useEffect(() => {
    if (!selectedDate || !selectedService) return;
    setLoadingSlots(true);
    setSelectedSlot(null);
    fetch(`${API_URL}/booking/${tenantSlug}/slots?date=${selectedDate}&serviceId=${selectedService.id}`)
      .then(r => r.json())
      .then(res => {
        if (res.success) setSlots(res.data?.slots || []);
        else setSlots([]);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, selectedService, tenantSlug]);

  const handleBook = async () => {
    if (!selectedService || !selectedDate || !selectedSlot || !customerName || !customerPhone) return;
    setBooking(true);
    try {
      const res = await fetch(`${API_URL}/booking/${tenantSlug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedService.id,
          date: selectedDate,
          startTime: selectedSlot.start,
          customerName,
          customerPhone,
          customerEmail: customerEmail || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmationData(data.data);
        setStep("confirmed");
      } else {
        setError(data.message || "Booking failed");
      }
    } catch {
      setError("Connection error");
    }
    setBooking(false);
  };

  // Calendar helpers
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1; // Monday start
    const days: (number | null)[] = Array(offset).fill(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [calendarMonth]);

  const monthLabel = calendarMonth.toLocaleDateString("es-CO", { month: "long", year: "numeric" });

  const isDateSelectable = (day: number) => {
    const d = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return str >= todayStr;
  };

  const formatDateStr = (day: number) => {
    const d = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error && step !== "confirmed") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-md">
          <p className="text-red-500 font-medium">{error}</p>
          <button onClick={() => { setError(""); setStep("services"); }} className="mt-4 text-indigo-600 text-sm hover:underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-indigo-50/30">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center">
            <Calendar size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Book an Appointment</h1>
            <p className="text-xs text-gray-500">Choose a service and pick your preferred time</p>
          </div>
        </div>
      </div>

      {/* Progress */}
      {step !== "confirmed" && (
        <div className="max-w-2xl mx-auto px-4 pt-6">
          <div className="flex gap-1">
            {(["services", "date", "time", "info"] as Step[]).map((s, i) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${
                (["services", "date", "time", "info"].indexOf(step) >= i) ? "bg-indigo-500" : "bg-gray-200"
              }`} />
            ))}
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Step 1: Services */}
        {step === "services" && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Select a service</h2>
            <div className="grid gap-3">
              {services.map(svc => (
                <button
                  key={svc.id}
                  onClick={() => { setSelectedService(svc); setStep("date"); }}
                  className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all text-left cursor-pointer group"
                >
                  <div className="w-3 h-12 rounded-full shrink-0" style={{ backgroundColor: svc.color }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">{svc.name}</h3>
                    {svc.description && <p className="text-sm text-gray-500 mt-0.5 truncate">{svc.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Clock size={12} /> {svc.durationMinutes} min</span>
                      {svc.price > 0 && <span>${svc.price.toLocaleString()}</span>}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-gray-300 group-hover:text-indigo-400 transition-colors" />
                </button>
              ))}
            </div>
            {services.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center border border-gray-200">
                <Calendar size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No services available at this time</p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Date */}
        {step === "date" && selectedService && (
          <div className="space-y-4">
            <button onClick={() => setStep("services")} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline bg-transparent border-none cursor-pointer">
              <ChevronLeft size={16} /> Back
            </button>
            <h2 className="text-xl font-bold text-gray-900">Pick a date</h2>
            <p className="text-sm text-gray-500">{selectedService.name} — {selectedService.durationMinutes} min</p>

            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                  className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer border-none bg-transparent text-gray-500">
                  <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-semibold text-gray-900 capitalize">{monthLabel}</span>
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                  className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer border-none bg-transparent text-gray-500">
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                  <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase py-1">{d}</div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, i) => {
                  if (day === null) return <div key={`empty-${i}`} />;
                  const selectable = isDateSelectable(day);
                  const dateStr = formatDateStr(day);
                  const isSelected = dateStr === selectedDate;
                  const isToday = dateStr === todayStr;
                  return (
                    <button
                      key={day}
                      disabled={!selectable}
                      onClick={() => { setSelectedDate(dateStr); setStep("time"); }}
                      className={`aspect-square rounded-xl text-sm font-medium transition-all cursor-pointer border-none ${
                        isSelected
                          ? "bg-indigo-500 text-white shadow-md"
                          : selectable
                            ? isToday
                              ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                              : "bg-transparent text-gray-700 hover:bg-gray-100"
                            : "bg-transparent text-gray-300 cursor-not-allowed"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Time */}
        {step === "time" && selectedService && selectedDate && (
          <div className="space-y-4">
            <button onClick={() => setStep("date")} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline bg-transparent border-none cursor-pointer">
              <ChevronLeft size={16} /> Back
            </button>
            <h2 className="text-xl font-bold text-gray-900">Choose a time</h2>
            <p className="text-sm text-gray-500">
              {selectedService.name} — {new Date(selectedDate + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
            </p>

            {loadingSlots ? (
              <div className="flex justify-center py-10">
                <Loader2 size={24} className="animate-spin text-indigo-500" />
              </div>
            ) : slots.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center border border-gray-200">
                <Clock size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No available slots for this date</p>
                <button onClick={() => setStep("date")} className="mt-3 text-indigo-600 text-sm hover:underline bg-transparent border-none cursor-pointer">
                  Choose another date
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {slots.map(slot => (
                  <button
                    key={slot.start}
                    onClick={() => { setSelectedSlot(slot); setStep("info"); }}
                    className={`py-3 px-2 rounded-xl text-sm font-medium border transition-all cursor-pointer ${
                      selectedSlot?.start === slot.start
                        ? "bg-indigo-500 text-white border-indigo-500 shadow-md"
                        : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50"
                    }`}
                  >
                    {slot.display || slot.start}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Customer info */}
        {step === "info" && selectedService && selectedSlot && (
          <div className="space-y-4">
            <button onClick={() => setStep("time")} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline bg-transparent border-none cursor-pointer">
              <ChevronLeft size={16} /> Back
            </button>
            <h2 className="text-xl font-bold text-gray-900">Your information</h2>

            {/* Summary card */}
            <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedService.color }} />
                {selectedService.name}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-indigo-600">
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })}
                </span>
                <span className="flex items-center gap-1"><Clock size={12} /> {selectedSlot.start}</span>
                <span>{selectedService.durationMinutes} min</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                  <User size={14} /> Full name *
                </label>
                <input
                  type="text" value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                  <Phone size={14} /> Phone *
                </label>
                <input
                  type="tel" value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="+57 300 123 4567"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                  <Mail size={14} /> Email
                </label>
                <input
                  type="email" value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                  <FileText size={14} /> Notes
                </label>
                <textarea
                  rows={2} value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any additional details..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                />
              </div>

              <button
                onClick={handleBook}
                disabled={booking || !customerName || !customerPhone}
                className="w-full py-3 rounded-xl bg-indigo-500 text-white font-semibold text-sm cursor-pointer border-none hover:bg-indigo-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {booking ? <><Loader2 size={16} className="animate-spin" /> Booking...</> : "Confirm Booking"}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Confirmation */}
        {step === "confirmed" && confirmationData && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} className="text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Booking Confirmed!</h2>
            <p className="text-sm text-gray-500 mb-6">You will receive a confirmation message shortly</p>

            <div className="bg-gray-50 rounded-xl p-5 text-left space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <MapPin size={14} className="text-gray-400" />
                <span className="font-medium text-gray-900">{confirmationData.service}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar size={14} className="text-gray-400" />
                <span className="text-gray-700">
                  {new Date(confirmationData.date + "T12:00:00").toLocaleDateString("es-CO", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock size={14} className="text-gray-400" />
                <span className="text-gray-700">{confirmationData.startTime} - {confirmationData.endTime}</span>
              </div>
            </div>

            <button
              onClick={() => {
                setStep("services");
                setSelectedService(null);
                setSelectedDate("");
                setSelectedSlot(null);
                setCustomerName("");
                setCustomerPhone("");
                setCustomerEmail("");
                setNotes("");
                setConfirmationData(null);
              }}
              className="mt-6 text-indigo-600 text-sm font-medium hover:underline bg-transparent border-none cursor-pointer"
            >
              Book another appointment
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-6 text-xs text-gray-400">
        Powered by Parallly
      </div>
    </div>
  );
}
