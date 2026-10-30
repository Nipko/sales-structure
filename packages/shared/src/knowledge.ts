export interface KnowledgeGapReport {
    unavailableSections: Array<'lowSatisfactionDocs' | 'staleDocuments' | 'falsePositiveCounts'>;
    lowSatisfactionDocs: Array<{ id: string; title: string; satisfaction_score: number; feedback_count: number }>;
    staleDocuments: Array<{ id: string; title: string; updated_at: string; query_frequency: number }>;
    falsePositiveCounts: Array<{ document_id: string | null; title: string | null; false_positive_count: number }>;
}
