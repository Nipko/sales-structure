import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-refresh',
    jwtExpiration: process.env.JWT_EXPIRATION || '15m',
    jwtRefreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
    encryptionKey: process.env.ENCRYPTION_KEY || '',
}));
