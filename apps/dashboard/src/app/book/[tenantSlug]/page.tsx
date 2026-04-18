"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Calendar, Clock, ChevronLeft, ChevronRight, CheckCircle2,
  Loader2, MapPin, User, Phone, Mail, FileText,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/* ── Inline i18n for public page (no next-intl) ───────────── */
const translations: Record<string, Record<string, string>> = {
  en: {
    title: "Book an Appointment", subtitle: "Choose a service and pick your preferred time",
    selectService: "Select a service", pickDate: "Pick a date", chooseTime: "Choose a time",
    yourInfo: "Your information", confirmed: "Booking Confirmed!",
    confirmMessage: "You will receive a confirmation message shortly",
    back: "Back", today: "Today", noSlots: "No available slots for this date",
    chooseAnother: "Choose another date", noServices: "No services available at this time",
    fullName: "Full name", phone: "Phone", email: "Email", notesLabel: "Notes",
    confirmBooking: "Confirm Booking", booking: "Booking...",
    bookAnother: "Book another appointment", readMore: "Read more",
    connectionError: "Connection error", bookingFailed: "Booking failed",
    loadError: "Could not load services", tryAgain: "Try again",
    min: "min", poweredBy: "Powered by Parallly",
    dayMon: "Mon", dayTue: "Tue", dayWed: "Wed", dayThu: "Thu", dayFri: "Fri", daySat: "Sat", daySun: "Sun",
  },
  es: {
    title: "Agendar una cita", subtitle: "Escoge un servicio y tu horario preferido",
    selectService: "Selecciona un servicio", pickDate: "Elige una fecha", chooseTime: "Elige un horario",
    yourInfo: "Tu informacion", confirmed: "Cita confirmada!",
    confirmMessage: "Recibiras un mensaje de confirmacion en breve",
    back: "Volver", today: "Hoy", noSlots: "No hay horarios disponibles para esta fecha",
    chooseAnother: "Elegir otra fecha", noServices: "No hay servicios disponibles en este momento",
    fullName: "Nombre completo", phone: "Telefono", email: "Correo", notesLabel: "Notas",
    confirmBooking: "Confirmar reserva", booking: "Reservando...",
    bookAnother: "Agendar otra cita", readMore: "Leer mas",
    connectionError: "Error de conexion", bookingFailed: "Error al reservar",
    loadError: "No se pudieron cargar los servicios", tryAgain: "Intentar de nuevo",
    min: "min", poweredBy: "Powered by Parallly",
    dayMon: "Lun", dayTue: "Mar", dayWed: "Mie", dayThu: "Jue", dayFri: "Vie", daySat: "Sab", daySun: "Dom",
  },
  pt: {
    title: "Agendar um compromisso", subtitle: "Escolha um servico e seu horario preferido",
    selectService: "Selecione um servico", pickDate: "Escolha uma data", chooseTime: "Escolha um horario",
    yourInfo: "Suas informacoes", confirmed: "Agendamento confirmado!",
    confirmMessage: "Voce recebera uma mensagem de confirmacao em breve",
    back: "Voltar", today: "Hoje", noSlots: "Sem horarios disponiveis para esta data",
    chooseAnother: "Escolher outra data", noServices: "Nenhum servico disponivel no momento",
    fullName: "Nome completo", phone: "Telefone", email: "Email", notesLabel: "Notas",
    confirmBooking: "Confirmar reserva", booking: "Reservando...",
    bookAnother: "Agendar outro compromisso", readMore: "Leia mais",
    connectionError: "Erro de conexao", bookingFailed: "Erro ao reservar",
    loadError: "Nao foi possivel carregar os servicos", tryAgain: "Tentar novamente",
    min: "min", poweredBy: "Powered by Parallly",
    dayMon: "Seg", dayTue: "Ter", dayWed: "Qua", dayThu: "Qui", dayFri: "Sex", daySat: "Sab", daySun: "Dom",
  },
  fr: {
    title: "Prendre rendez-vous", subtitle: "Choisissez un service et votre creneau prefere",
    selectService: "Selectionnez un service", pickDate: "Choisissez une date", chooseTime: "Choisissez un horaire",
    yourInfo: "Vos informations", confirmed: "Rendez-vous confirme !",
    confirmMessage: "Vous recevrez un message de confirmation sous peu",
    back: "Retour", today: "Aujourd'hui", noSlots: "Aucun creneau disponible pour cette date",
    chooseAnother: "Choisir une autre date", noServices: "Aucun service disponible pour le moment",
    fullName: "Nom complet", phone: "Telephone", email: "Email", notesLabel: "Notes",
    confirmBooking: "Confirmer la reservation", booking: "Reservation...",
    bookAnother: "Prendre un autre rendez-vous", readMore: "En savoir plus",
    connectionError: "Erreur de connexion", bookingFailed: "Echec de la reservation",
    loadError: "Impossible de charger les services", tryAgain: "Reessayer",
    min: "min", poweredBy: "Powered by Parallly",
    dayMon: "Lun", dayTue: "Mar", dayWed: "Mer", dayThu: "Jeu", dayFri: "Ven", daySat: "Sam", daySun: "Dim",
  },
};

function detectLang(): string {
  if (typeof navigator === "undefined") return "es";
  const lang = navigator.language?.slice(0, 2) || "es";
  return translations[lang] ? lang : "es";
}

interface Service { id: string; name: string; description: string | null; durationMinutes: number; price: number; currency: string; color: string; }
interface Slot { start: string; end: string; display: string; }
type Step = "services" | "date" | "time" | "info" | "confirmed";

export default function PublicBookingPage() {
  const params = useParams();
  const tenantSlug = params.tenantSlug as string;
  const [lang] = useState(detectLang);
  const t = (key: string) => translations[lang]?.[key] || translations.en[key] || key;
  const dateLocale = lang === "pt" ? "pt-BR" : lang === "fr" ? "fr-FR" : lang === "en" ? "en-US" : "es-MX";
  const dayHeaders = ["dayMon", "dayTue", "dayWed", "dayThu", "dayFri", "daySat", "daySun"];

  const [tenantInfo, setTenantInfo] = useState<{ name: string; logo: string | null; color: string | null }>({ name: "", logo: null, color: null });
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  useEffect(() => {
    if (!tenantSlug) return;
    setLoading(true);
    // Fetch tenant branding + services in parallel
    Promise.all([
      fetch(`${API_URL}/booking/${tenantSlug}/info`).then(r => r.json()).catch(() => null),
      fetch(`${API_URL}/booking/${tenantSlug}/services`).then(r => r.json()),
    ]).then(([infoRes, svcRes]) => {
      if (infoRes?.success) setTenantInfo(infoRes.data);
      if (svcRes?.success) setServices(svcRes.data || []);
      else setError(t("loadError"));
    }).catch(() => setError(t("connectionError")))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  useEffect(() => {
    if (!selectedDate || !selectedService) return;
    setLoadingSlots(true);
    setSelectedSlot(null);
    fetch(`${API_URL}/booking/${tenantSlug}/slots?date=${selectedDate}&serviceId=${selectedService.id}`)
      .then(r => r.json())
      .then(res => { if (res.success) setSlots(res.data?.slots || []); else setSlots([]); })
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
          serviceId: selectedService.id, date: selectedDate, startTime: selectedSlot.start,
          customerName, customerPhone, customerEmail: customerEmail || undefined, notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) { setConfirmationData(data.data); setStep("confirmed"); }
      else setError(data.message || t("bookingFailed"));
    } catch { setError(t("connectionError")); }
    setBooking(false);
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const days: (number | null)[] = Array(offset).fill(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [calendarMonth]);

  const monthLabel = calendarMonth.toLocaleDateString(dateLocale, { month: "long", year: "numeric" });
  const isDateSelectable = (day: number) => {
    const d = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` >= todayStr;
  };
  const formatDateStr = (day: number) => {
    const d = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  if (loading) return <div className="min-h-screen bg-neutral-50 flex items-center justify-center"><Loader2 size={32} className="animate-spin text-indigo-500" /></div>;

  if (error && step !== "confirmed") return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
        <p className="text-red-500 font-medium">{error}</p>
        <button onClick={() => { setError(""); setStep("services"); }} className="mt-4 text-indigo-600 text-sm hover:underline">{t("tryAgain")}</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 to-indigo-50/30">
      <div className="bg-white border-b border-neutral-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center gap-3">
          {tenantInfo.logo ? (
            <img src={tenantInfo.logo} alt="" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: tenantInfo.color || '#6366f1' }}>
              <Calendar size={20} className="text-white" />
            </div>
          )}
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{tenantInfo.name || t("title")}</h1>
            <p className="text-xs text-neutral-500">{t("subtitle")}</p>
          </div>
        </div>
      </div>

      {step !== "confirmed" && (
        <div className="max-w-2xl mx-auto px-4 pt-6">
          <div className="flex gap-1">
            {(["services", "date", "time", "info"] as Step[]).map((s, i) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${["services", "date", "time", "info"].indexOf(step) >= i ? "bg-indigo-500" : "bg-neutral-200"}`} />
            ))}
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Step 1: Services */}
        {step === "services" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-neutral-900">{t("selectService")}</h2>
            <div className="grid gap-3">
              {services.map(svc => (
                <button key={svc.id} onClick={() => { setSelectedService(svc); setStep("date"); }}
                  className="flex items-center gap-4 p-5 bg-white rounded-xl border border-neutral-200 hover:border-indigo-300 hover:shadow-md transition-all text-left cursor-pointer group">
                  <div className="w-3 h-12 rounded-full shrink-0" style={{ backgroundColor: svc.color }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-neutral-900 group-hover:text-indigo-600 transition-colors">{svc.name}</h3>
                    {svc.description && <p className="text-sm text-neutral-500 mt-0.5 truncate">{svc.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400">
                      <span className="flex items-center gap-1"><Clock size={12} /> {svc.durationMinutes} {t("min")}</span>
                      {svc.price > 0 && <span>${svc.price.toLocaleString()}</span>}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-neutral-300 group-hover:text-indigo-400 transition-colors" />
                </button>
              ))}
            </div>
            {services.length === 0 && (
              <div className="bg-white rounded-xl p-10 text-center border border-neutral-200">
                <Calendar size={32} className="text-neutral-300 mx-auto mb-3" />
                <p className="text-neutral-500 text-sm">{t("noServices")}</p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Date */}
        {step === "date" && selectedService && (
          <div className="space-y-4">
            <button onClick={() => setStep("services")} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline bg-transparent border-none cursor-pointer"><ChevronLeft size={16} /> {t("back")}</button>
            <h2 className="text-xl font-semibold text-neutral-900">{t("pickDate")}</h2>
            <p className="text-sm text-neutral-500">{selectedService.name} — {selectedService.durationMinutes} {t("min")}</p>
            <div className="bg-white rounded-xl border border-neutral-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer border-none bg-transparent text-neutral-500"><ChevronLeft size={18} /></button>
                <span className="text-sm font-semibold text-neutral-900 capitalize">{monthLabel}</span>
                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer border-none bg-transparent text-neutral-500"><ChevronRight size={18} /></button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {dayHeaders.map(d => <div key={d} className="text-center text-[10px] font-semibold text-neutral-400 uppercase py-1">{t(d)}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, i) => {
                  if (day === null) return <div key={`e-${i}`} />;
                  const selectable = isDateSelectable(day);
                  const dateStr = formatDateStr(day);
                  const isSelected = dateStr === selectedDate;
                  const isToday = dateStr === todayStr;
                  return (
                    <button key={day} disabled={!selectable} onClick={() => { setSelectedDate(dateStr); setStep("time"); }}
                      className={`aspect-square rounded-xl text-sm font-medium transition-all cursor-pointer border-none ${isSelected ? "bg-indigo-500 text-white shadow-md" : selectable ? isToday ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100" : "bg-transparent text-neutral-700 hover:bg-neutral-100" : "bg-transparent text-neutral-300 cursor-not-allowed"}`}>
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
            <button onClick={() => setStep("date")} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline bg-transparent border-none cursor-pointer"><ChevronLeft size={16} /> {t("back")}</button>
            <h2 className="text-xl font-semibold text-neutral-900">{t("chooseTime")}</h2>
            <p className="text-sm text-neutral-500">
              {selectedService.name} — {new Date(selectedDate + "T12:00:00").toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long" })}
            </p>
            {loadingSlots ? (
              <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-indigo-500" /></div>
            ) : slots.length === 0 ? (
              <div className="bg-white rounded-xl p-10 text-center border border-neutral-200">
                <Clock size={32} className="text-neutral-300 mx-auto mb-3" />
                <p className="text-neutral-500 text-sm">{t("noSlots")}</p>
                <button onClick={() => setStep("date")} className="mt-3 text-indigo-600 text-sm hover:underline bg-transparent border-none cursor-pointer">{t("chooseAnother")}</button>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {slots.map(slot => (
                  <button key={slot.start} onClick={() => { setSelectedSlot(slot); setStep("info"); }}
                    className={`py-3 px-2 rounded-xl text-sm font-medium border transition-all cursor-pointer ${selectedSlot?.start === slot.start ? "bg-indigo-500 text-white border-indigo-500 shadow-md" : "bg-white text-neutral-700 border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50"}`}>
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
            <button onClick={() => setStep("time")} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline bg-transparent border-none cursor-pointer"><ChevronLeft size={16} /> {t("back")}</button>
            <h2 className="text-xl font-semibold text-neutral-900">{t("yourInfo")}</h2>
            <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedService.color }} />
                {selectedService.name}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-indigo-600">
                <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(selectedDate + "T12:00:00").toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {selectedSlot.start}</span>
                <span>{selectedService.durationMinutes} {t("min")}</span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-neutral-200 p-5 space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 mb-1.5"><User size={14} /> {t("fullName")} *</label>
                <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400" />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 mb-1.5"><Phone size={14} /> {t("phone")} *</label>
                <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+57 300 123 4567" className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400" />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 mb-1.5"><Mail size={14} /> {t("email")}</label>
                <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400" />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 mb-1.5"><FileText size={14} /> {t("notesLabel")}</label>
                <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-neutral-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400" />
              </div>
              <button onClick={handleBook} disabled={booking || !customerName || !customerPhone}
                className="w-full py-3 rounded-xl bg-indigo-500 text-white font-semibold text-sm cursor-pointer border-none hover:bg-indigo-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {booking ? <><Loader2 size={16} className="animate-spin" /> {t("booking")}</> : t("confirmBooking")}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Confirmation */}
        {step === "confirmed" && confirmationData && (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} className="text-emerald-500" /></div>
            <h2 className="text-xl font-semibold text-neutral-900 mb-1">{t("confirmed")}</h2>
            <p className="text-sm text-neutral-500 mb-6">{t("confirmMessage")}</p>
            <div className="bg-neutral-50 rounded-xl p-5 text-left space-y-3">
              <div className="flex items-center gap-2 text-sm"><MapPin size={14} className="text-neutral-400" /><span className="font-medium text-neutral-900">{confirmationData.service}</span></div>
              <div className="flex items-center gap-2 text-sm"><Calendar size={14} className="text-neutral-400" /><span className="text-neutral-700">{new Date(confirmationData.date + "T12:00:00").toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span></div>
              <div className="flex items-center gap-2 text-sm"><Clock size={14} className="text-neutral-400" /><span className="text-neutral-700">{confirmationData.startTime} - {confirmationData.endTime}</span></div>
            </div>
            <button onClick={() => { setStep("services"); setSelectedService(null); setSelectedDate(""); setSelectedSlot(null); setCustomerName(""); setCustomerPhone(""); setCustomerEmail(""); setNotes(""); setConfirmationData(null); }}
              className="mt-6 text-indigo-600 text-sm font-medium hover:underline bg-transparent border-none cursor-pointer">{t("bookAnother")}</button>
          </div>
        )}
      </div>

      <div className="text-center py-6 text-xs text-neutral-400">{t("poweredBy")}</div>
    </div>
  );
}
