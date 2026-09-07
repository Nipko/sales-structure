/** Safe, frozen configuration fields that a person actually reviews. No provider or connection payloads. */
export type AgentReleaseSubjectValue = string | number | boolean | string[] | null;
export interface AgentReleaseSubjectField { key: string; value: AgentReleaseSubjectValue }
export interface AgentReleaseReviewSubject {
    version: 1;
    configurationRevisionId: string | null;
    configurationHash: string | null;
    baseOperationalVersion: number | null;
    baseOperationalHash: string | null;
    fields: AgentReleaseSubjectField[];
    baseFields: AgentReleaseSubjectField[] | null;
    changes: Array<{ key: string; before: AgentReleaseSubjectValue; after: AgentReleaseSubjectValue }> | null;
}
