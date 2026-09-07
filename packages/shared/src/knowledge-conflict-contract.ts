/** Evidence of a reported difference, not certification that either source is true. */
export interface KnowledgeConflictAnnotation {
    id: string;
    state: 'potential_conflict' | 'reviewed_preference';
    sourceHash: string;
    sourceRevision: string;
    quote: string;
    related: { kind: 'document' | 'faq' | 'policy' | 'business'; id: string; title: string; revision: string; hash: string; quote: string };
    preferredSource: { kind: 'document' | 'faq' | 'policy' | 'business'; id: string } | null;
    reviewScope?: { audience: 'customer' | 'internal'; agentId: string | null; jurisdiction: string | null } | null;
    correctness: 'not_verified';
}
