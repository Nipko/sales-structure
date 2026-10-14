// Applied through executeInTenantSchema (transaction-scoped DDL lock).
// Qualify the table so a missing historical tenant table cannot fall back to public.
export function knowledgeFileTypeWidenSql(schemaName: string): string {
    if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) throw new Error('invalid_tenant_schema');
    // MIME values such as DOCX exceed 50 characters; preserve the complete value.
    return `ALTER TABLE "${schemaName}"."knowledge_documents" ALTER COLUMN "file_type" TYPE TEXT;`;
}
