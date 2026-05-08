"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { PawPrint, Loader2, Search, Syringe, Calendar, ChevronRight } from "lucide-react";

interface PetRow {
    id: string;
    name: string;
    species: string;
    breed: string | null;
    sex: string | null;
    birth_date: string | null;
    weight_kg: number | null;
    color: string | null;
    photo_url: string | null;
    contact_id: string;
    contact_name: string | null;
    contact_phone: string | null;
    vaccinations_count: number;
    last_visit: string | null;
}

const SPECIES_FILTERS = ["all", "dog", "cat", "other"] as const;
type SpeciesFilter = typeof SPECIES_FILTERS[number];

const SPECIES_EMOJI: Record<string, string> = {
    dog: "🐕",
    cat: "🐈",
    bird: "🦜",
    rabbit: "🐰",
    hamster: "🐹",
    reptile: "🦎",
    fish: "🐠",
    other: "🐾",
};

function ageFromBirth(date: string | null): string {
    if (!date) return "—";
    const birth = new Date(date);
    const now = new Date();
    const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
    if (months < 12) return `${months}m`;
    const years = Math.floor(months / 12);
    return years === 1 ? "1 año" : `${years} años`;
}

export default function PetsPage() {
    const t = useTranslations("petsPage");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [pets, setPets] = useState<PetRow[]>([]);
    const [filter, setFilter] = useState<SpeciesFilter>("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        const speciesParam = filter === "all" ? undefined : (filter === "other" ? "other" : filter);
        const res = await api.listAllPets(activeTenantId, {
            species: speciesParam,
            search: search || undefined,
        });
        if (res.success && Array.isArray(res.data)) setPets(res.data as PetRow[]);
        setLoading(false);
    }, [activeTenantId, filter, search]);

    useEffect(() => { load(); }, [load]);

    const tabs = SPECIES_FILTERS.map((id) => ({
        id,
        label: t(`filters.${id}`),
    }));

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={PawPrint}
            />

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <TabNav
                    tabs={tabs}
                    activeTab={filter}
                    onTabChange={(id) => setFilter(id as SpeciesFilter)}
                />
                <div className="relative md:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input
                        type="search"
                        placeholder={t("searchPlaceholder")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                    />
                </div>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
            )}

            {!loading && pets.length === 0 && (
                <div className="bg-white dark:bg-neutral-900 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl py-16 text-center">
                    <PawPrint className="w-10 h-10 text-neutral-300 dark:text-neutral-700 mx-auto mb-3" />
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{t("empty.title")}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{t("empty.hint")}</p>
                </div>
            )}

            {!loading && pets.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {pets.map((pet) => (
                        <Link
                            key={pet.id}
                            href={pet.contact_id ? `/admin/contacts/${pet.contact_id}` : "#"}
                            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm transition-all group"
                        >
                            <div className="flex items-start gap-3">
                                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center text-2xl flex-shrink-0">
                                    {pet.photo_url ? (
                                        <img src={pet.photo_url} alt={pet.name} className="w-14 h-14 rounded-full object-cover" />
                                    ) : (
                                        <span>{SPECIES_EMOJI[pet.species] || "🐾"}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 justify-between">
                                        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                                            {pet.name}
                                        </h3>
                                        <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:text-indigo-500 flex-shrink-0" />
                                    </div>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                        {[pet.breed, pet.sex, ageFromBirth(pet.birth_date)].filter(Boolean).join(" · ")}
                                    </p>
                                    {pet.contact_name && (
                                        <p className="text-xs text-neutral-700 dark:text-neutral-300 mt-1 truncate">
                                            <span className="text-neutral-500">{t("col.owner")}:</span> {pet.contact_name}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
                                <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                                    <Syringe className="w-3.5 h-3.5" />
                                    <span>{pet.vaccinations_count} {t("col.vaccinations").toLowerCase()}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                                    <Calendar className="w-3.5 h-3.5" />
                                    <span>
                                        {pet.last_visit
                                            ? new Date(pet.last_visit).toLocaleDateString()
                                            : "—"}
                                    </span>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
