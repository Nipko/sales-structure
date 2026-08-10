export function resourceRentalCustomer(row: Record<string, any>): string {
    return String(
        row.customer_name
        || row.contact_name
        || row.customerName
        || row.contactName
        || '',
    );
}

export function resourceRentalPhone(row: Record<string, any>): string {
    return String(
        row.customer_phone
        || row.contact_phone
        || row.customerPhone
        || row.contactPhone
        || '',
    );
}
