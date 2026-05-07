"use client";

/**
 * Pets card — collapsible panel that shows the contact's registered pets
 * (the contact in vet workflows is the tutor / pet parent). Each pet row
 * lists species, breed, age and a vaccination summary. Clicking a pet
 * expands its full vaccination history with quick actions to add a new
 * vaccination record.
 *
 * Mounted by lead detail when verticalConfig.industry === 'veterinaria'.
 */

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
    PawPrint, ChevronDown, ChevronUp, Plus, Trash2, AlertCircle,
    Syringe, Calendar, X,
} from "lucide-react";

interface Pet {
    id: string;
    name: string;
    species: string;
    breed?: string;
    sex?: string;
    is_neutered?: boolean;
    birth_date?: string;
    weight_kg?: number;
    color?: string;
    microchip_id?: string;
    allergies?: string;
    chronic_conditions?: string;
    current_medications?: string;
    photo_url?: string;
    is_active: boolean;
    created_at: string;
}

interface Vaccination {
    id: string;
    pet_id: string;
    vaccine_name: string;
    applied_at: string;
    next_due_at?: string;
    lot_number?: string;
    vet_name?: string;
    notes?: string;
}

const SPECIES_OPTIONS = [
    { value: "dog", labelKey: "speciesDog" },
    { value: "cat", labelKey: "speciesCat" },
    { value: "bird", labelKey: "speciesBird" },
    { value: "rabbit", labelKey: "speciesRabbit" },
    { value: "reptile", labelKey: "speciesReptile" },
    { value: "rodent", labelKey: "speciesRodent" },
    { value: "fish", labelKey: "speciesFish" },
    { value: "other", labelKey: "speciesOther" },
];

export function PetsCard({
    tenantId, contactId,
}: {
    tenantId: string;
    contactId: string;
}) {
    const t = useTranslations("petsCard");
    const tc = useTranslations("common");
    const [pets, setPets] = useState<Pet[]>([]);
    const [vaccinations, setVaccinations] = useState<Record<string, Vaccination[]>>({});
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [expandedPet, setExpandedPet] = useState<string | null>(null);
    const [showVaccineForm, setShowVaccineForm] = useState<string | null>(null);

    const [petForm, setPetForm] = useState({
        name: "", species: "dog", breed: "", sex: "", weightKg: "", birthDate: "",
        color: "", allergies: "", chronicConditions: "",
    });
    const [vaccineForm, setVaccineForm] = useState({
        vaccineName: "", appliedAt: "", nextDueAt: "", lotNumber: "", vetName: "", notes: "",
    });

    useEffect(() => {
        if (!open || loaded) return;
        loadPets();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    async function loadPets() {
        const res = await api.listPetsForContact(tenantId, contactId);
        if (res.success && Array.isArray(res.data)) setPets(res.data);
        setLoaded(true);
    }

    async function loadVaccinations(petId: string) {
        const res = await api.getPet(tenantId, petId);
        if (res.success && res.data?.vaccinations) {
            setVaccinations(prev => ({ ...prev, [petId]: res.data.vaccinations }));
        }
    }

    async function handleCreatePet() {
        if (!petForm.name) return;
        const res = await api.createPet(tenantId, {
            contactId,
            name: petForm.name,
            species: petForm.species,
            breed: petForm.breed || undefined,
            sex: petForm.sex || undefined,
            birthDate: petForm.birthDate || undefined,
            weightKg: petForm.weightKg ? parseFloat(petForm.weightKg) : undefined,
            color: petForm.color || undefined,
            allergies: petForm.allergies || undefined,
            chronicConditions: petForm.chronicConditions || undefined,
        });
        if (res.success) {
            setShowCreate(false);
            setPetForm({ name: "", species: "dog", breed: "", sex: "", weightKg: "", birthDate: "", color: "", allergies: "", chronicConditions: "" });
            loadPets();
        }
    }

    async function handleAddVaccination(petId: string) {
        if (!vaccineForm.vaccineName || !vaccineForm.appliedAt) return;
        const res = await api.addPetVaccination(tenantId, petId, {
            vaccineName: vaccineForm.vaccineName,
            appliedAt: vaccineForm.appliedAt,
            nextDueAt: vaccineForm.nextDueAt || undefined,
            lotNumber: vaccineForm.lotNumber || undefined,
            vetName: vaccineForm.vetName || undefined,
            notes: vaccineForm.notes || undefined,
        });
        if (res.success) {
            setShowVaccineForm(null);
            setVaccineForm({ vaccineName: "", appliedAt: "", nextDueAt: "", lotNumber: "", vetName: "", notes: "" });
            loadVaccinations(petId);
        }
    }

    async function handleDeletePet(petId: string) {
        if (!confirm(t("confirmDelete"))) return;
        await api.deletePet(tenantId, petId);
        loadPets();
    }

    async function handleDeleteVaccination(vaccinationId: string, petId: string) {
        await api.deletePetVaccination(tenantId, vaccinationId);
        loadVaccinations(petId);
    }

    const ageYears = (birthDate?: string) => {
        if (!birthDate) return null;
        const years = Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365));
        return years >= 1 ? `${years} ${years === 1 ? t("yearAge") : t("yearsAge")}` : t("under1Year");
    };

    const speciesLabel = (s: string) => {
        const opt = SPECIES_OPTIONS.find(o => o.value === s);
        return opt ? t(opt.labelKey as any) : s;
    };

    const vaccineSummary = (petId: string) => {
        const list = vaccinations[petId] || [];
        if (!list.length) return { upcoming: 0, overdue: 0, total: 0 };
        const today = new Date();
        const lastByVaccine: Record<string, Vaccination> = {};
        for (const v of list) {
            if (!lastByVaccine[v.vaccine_name] ||
                new Date(v.applied_at) > new Date(lastByVaccine[v.vaccine_name].applied_at)) {
                lastByVaccine[v.vaccine_name] = v;
            }
        }
        let overdue = 0, upcoming = 0;
        for (const v of Object.values(lastByVaccine)) {
            if (!v.next_due_at) continue;
            if (new Date(v.next_due_at) < today) overdue++;
            else upcoming++;
        }
        return { upcoming, overdue, total: list.length };
    };

    return (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition"
            >
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <PawPrint className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="text-left">
                        <div className="font-semibold">{t("title")}</div>
                        <div className="text-xs text-muted-foreground">
                            {pets.length === 0 && loaded
                                ? t("noPets")
                                : t("petsCount", { count: pets.length })}
                        </div>
                    </div>
                </div>
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {open && (
                <div className="border-t border-border p-4 space-y-3">
                    {!loaded && <div className="text-sm text-muted-foreground">{tc("loading")}</div>}

                    {loaded && pets.map(pet => {
                        const isExpanded = expandedPet === pet.id;
                        const vacs = vaccinations[pet.id] || [];
                        const summary = vaccineSummary(pet.id);

                        return (
                            <div key={pet.id} className="border border-border rounded-lg overflow-hidden">
                                <div
                                    className="p-3 flex items-center justify-between cursor-pointer hover:bg-muted/20"
                                    onClick={() => {
                                        if (isExpanded) {
                                            setExpandedPet(null);
                                        } else {
                                            setExpandedPet(pet.id);
                                            if (!vaccinations[pet.id]) loadVaccinations(pet.id);
                                        }
                                    }}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                                            <PawPrint className="h-5 w-5 text-white" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-medium truncate">{pet.name}</div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {speciesLabel(pet.species)}
                                                {pet.breed && ` · ${pet.breed}`}
                                                {pet.birth_date && ` · ${ageYears(pet.birth_date)}`}
                                                {pet.weight_kg && ` · ${pet.weight_kg} kg`}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {summary.overdue > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-600 border border-red-500/20">
                                                <AlertCircle className="h-3 w-3" />
                                                {summary.overdue}
                                            </span>
                                        )}
                                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="border-t border-border p-3 space-y-3 bg-muted/10">
                                        {(pet.allergies || pet.chronic_conditions) && (
                                            <div className="space-y-1 text-xs">
                                                {pet.allergies && (
                                                    <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                                                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                                        <span><strong>{t("allergies")}:</strong> {pet.allergies}</span>
                                                    </div>
                                                )}
                                                {pet.chronic_conditions && (
                                                    <div className="flex items-start gap-1.5 text-orange-700 dark:text-orange-400">
                                                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                                        <span><strong>{t("chronic")}:</strong> {pet.chronic_conditions}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between">
                                            <div className="text-sm font-medium flex items-center gap-1.5">
                                                <Syringe className="h-3.5 w-3.5" />
                                                {t("vaccinations")} ({vacs.length})
                                            </div>
                                            <button
                                                onClick={() => setShowVaccineForm(showVaccineForm === pet.id ? null : pet.id)}
                                                className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded inline-flex items-center gap-1"
                                            >
                                                <Plus className="h-3 w-3" /> {t("addVaccination")}
                                            </button>
                                        </div>

                                        {showVaccineForm === pet.id && (
                                            <div className="bg-card p-3 rounded-lg border border-border space-y-2">
                                                <input
                                                    type="text"
                                                    placeholder={t("vaccineName")}
                                                    value={vaccineForm.vaccineName}
                                                    onChange={(e) => setVaccineForm({ ...vaccineForm, vaccineName: e.target.value })}
                                                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                                                />
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="text-xs text-muted-foreground">{t("appliedAt")}</label>
                                                        <input
                                                            type="date"
                                                            value={vaccineForm.appliedAt}
                                                            onChange={(e) => setVaccineForm({ ...vaccineForm, appliedAt: e.target.value })}
                                                            className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-muted-foreground">{t("nextDueAt")}</label>
                                                        <input
                                                            type="date"
                                                            value={vaccineForm.nextDueAt}
                                                            onChange={(e) => setVaccineForm({ ...vaccineForm, nextDueAt: e.target.value })}
                                                            className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 justify-end">
                                                    <button onClick={() => setShowVaccineForm(null)} className="text-xs px-2 py-1 hover:bg-muted rounded">{tc("cancel")}</button>
                                                    <button onClick={() => handleAddVaccination(pet.id)} className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded">{tc("save")}</button>
                                                </div>
                                            </div>
                                        )}

                                        {vacs.length > 0 && (
                                            <div className="space-y-1.5">
                                                {vacs.map(v => {
                                                    const isOverdue = v.next_due_at && new Date(v.next_due_at) < new Date();
                                                    return (
                                                        <div key={v.id} className="flex items-center justify-between p-2 bg-card rounded border border-border text-xs">
                                                            <div className="min-w-0">
                                                                <div className="font-medium truncate">{v.vaccine_name}</div>
                                                                <div className="text-muted-foreground flex items-center gap-2 mt-0.5">
                                                                    <Calendar className="h-3 w-3" />
                                                                    {new Date(v.applied_at).toLocaleDateString()}
                                                                    {v.next_due_at && (
                                                                        <span className={isOverdue ? "text-red-600 font-medium" : ""}>
                                                                            → {new Date(v.next_due_at).toLocaleDateString()}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleDeleteVaccination(v.id, pet.id)}
                                                                className="text-muted-foreground hover:text-red-600 p-1"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="pt-2 flex justify-end">
                                            <button
                                                onClick={() => handleDeletePet(pet.id)}
                                                className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                                            >
                                                <Trash2 className="h-3 w-3" /> {t("removePet")}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {showCreate ? (
                        <div className="border border-border rounded-lg p-3 bg-muted/10 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                                <input
                                    type="text"
                                    placeholder={t("petName")}
                                    value={petForm.name}
                                    onChange={(e) => setPetForm({ ...petForm, name: e.target.value })}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm"
                                />
                                <select
                                    value={petForm.species}
                                    onChange={(e) => setPetForm({ ...petForm, species: e.target.value })}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm"
                                >
                                    {SPECIES_OPTIONS.map(s => (
                                        <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    placeholder={t("breed")}
                                    value={petForm.breed}
                                    onChange={(e) => setPetForm({ ...petForm, breed: e.target.value })}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm"
                                />
                                <input
                                    type="number"
                                    step="0.1"
                                    placeholder={t("weightKg")}
                                    value={petForm.weightKg}
                                    onChange={(e) => setPetForm({ ...petForm, weightKg: e.target.value })}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm"
                                />
                                <input
                                    type="date"
                                    placeholder={t("birthDate")}
                                    value={petForm.birthDate}
                                    onChange={(e) => setPetForm({ ...petForm, birthDate: e.target.value })}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm"
                                />
                                <select
                                    value={petForm.sex}
                                    onChange={(e) => setPetForm({ ...petForm, sex: e.target.value })}
                                    className="bg-background border border-border rounded px-2 py-1 text-sm"
                                >
                                    <option value="">{t("sexUnknown")}</option>
                                    <option value="male">{t("sexMale")}</option>
                                    <option value="female">{t("sexFemale")}</option>
                                </select>
                            </div>
                            <input
                                type="text"
                                placeholder={t("allergies")}
                                value={petForm.allergies}
                                onChange={(e) => setPetForm({ ...petForm, allergies: e.target.value })}
                                className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                            />
                            <input
                                type="text"
                                placeholder={t("chronic")}
                                value={petForm.chronicConditions}
                                onChange={(e) => setPetForm({ ...petForm, chronicConditions: e.target.value })}
                                className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                            />
                            <div className="flex gap-2 justify-end">
                                <button onClick={() => setShowCreate(false)} className="text-sm px-3 py-1 hover:bg-muted rounded">{tc("cancel")}</button>
                                <button onClick={handleCreatePet} disabled={!petForm.name} className="text-sm px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded">{tc("save")}</button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowCreate(true)}
                            className="w-full p-3 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:bg-muted/20 hover:text-foreground inline-flex items-center justify-center gap-2 transition"
                        >
                            <Plus className="h-4 w-4" /> {t("registerNewPet")}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
