import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3002', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:3001',
  jwtSecret: process.env.INTERNAL_JWT_SECRET || 'change-me-in-production',
  encryptionKey: process.env.ENCRYPTION_KEY || '', // AES-256-GCM, requerido en producción
  logLevel: process.env.LOG_LEVEL || 'info',
}));
