import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { VERIFIED_EMAIL_CAPABILITY_KEY, type VerifiedEmailCapability } from '@parallext/shared';
import { EmailVerifiedGuard } from '../guards/email-verified.guard';

/** Server-side authorization marker; hiding a dashboard control is not a gate. */
export function RequiresVerifiedEmail(capability: VerifiedEmailCapability) {
    return applyDecorators(
        SetMetadata(VERIFIED_EMAIL_CAPABILITY_KEY, capability),
        UseGuards(EmailVerifiedGuard),
    );
}
