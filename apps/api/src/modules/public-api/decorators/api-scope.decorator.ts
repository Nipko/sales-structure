import { SetMetadata } from '@nestjs/common';

export const API_SCOPE_KEY = 'apiScope';
export const ApiScope = (scope: string) => SetMetadata(API_SCOPE_KEY, scope);
