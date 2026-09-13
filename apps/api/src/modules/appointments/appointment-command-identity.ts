import { createHash } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';

export function vehicleAppointmentCommand(schema: string, contactId: string, key: unknown, payload: unknown): { id: string; hash: string } {
    // Runtime supplies a durable ledger key; HTTP callers validate their UUID at the boundary.
    if (typeof key !== 'string' || !key.trim() || key.length>200) {
        throw new BadRequestException({ error: 'test_drive_request_key_required' });
    }
    const digest = createHash('sha256').update(JSON.stringify([schema, contactId, key])).digest('hex');
    return { id: `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`,
        hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
export function assertVehicleAppointmentReplay(row: any, hash: string, contactId: string): void {
    if (row.contact_id !== contactId || row.metadata?.vehicleAppointmentCommandHash !== hash) {
        throw new ConflictException({ error: 'test_drive_request_key_conflict' });
    }
}
