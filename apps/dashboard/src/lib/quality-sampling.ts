export interface QualitySamplingReport {
    state: 'not_captured' | 'available';
    day: string;
    eligible: number | null;
    selected: number | null;
    queued: number | null;
    pending: number | null;
    failed: number | null;
    erased: number | null;
    actualFraction?: number | null;
    evidence?: 'queue_acceptance';
}

export async function readQualitySampling(load: () => Promise<{success:boolean;data?:unknown}>): Promise<QualitySamplingReport> {
    const response = await load();
    const value = response.data as QualitySamplingReport;
    if (!response.success || !value || !['not_captured','available'].includes(value.state) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day))
        throw new Error('sampling_unavailable');
    const counts = ['eligible','selected','queued','pending','failed','erased'] as const;
    if (value.state === 'not_captured') {
        if (counts.some(key=>value[key]!==null)) throw new Error('sampling_unavailable');
    } else if (value.evidence !== 'queue_acceptance' || counts.some(key=>!Number.isInteger(value[key]) || Number(value[key])<0)
        || Number(value.selected)>Number(value.eligible)
        || Number(value.selected)!==Number(value.queued)+Number(value.pending)+Number(value.failed)+Number(value.erased)) {
        throw new Error('sampling_unavailable');
    }
    return value;
}
