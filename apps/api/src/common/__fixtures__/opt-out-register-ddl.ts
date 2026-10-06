/**
 * The two tables an opt-out is read from (`opt-out-register.ts`), with the
 * column names and types of `tenant-schema.sql` minus the foreign keys, for the
 * suites that build their own skinny tenant schema.
 */
export const OPT_OUT_REGISTER_DDL = [
    `CREATE TABLE leads(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), contact_id UUID, first_name VARCHAR(255),
        phone VARCHAR(50) NOT NULL, email VARCHAR(255), opted_out BOOLEAN DEFAULT false, opted_out_at TIMESTAMP)`,
    `CREATE TABLE opt_out_records(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, phone VARCHAR(50),
        channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp', trigger_msg TEXT, detected_from VARCHAR(20) DEFAULT 'keyword',
        status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`,
];
