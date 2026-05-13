import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && !process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required in production');
    }
    if (isProd && !process.env.JWT_REFRESH_SECRET) {
        throw new Error('JWT_REFRESH_SECRET environment variable is required in production');
    }
    return {
        jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-only-jwt-secret-not-for-production'),
        jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || (isProd ? '' : 'dev-only-refresh-secret-not-for-production'),
        jwtExpiration: process.env.JWT_EXPIRATION || '15m',
        jwtRefreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
        encryptionKey: process.env.ENCRYPTION_KEY || '',
    };
});
