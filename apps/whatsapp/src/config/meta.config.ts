import { registerAs } from '@nestjs/config';

export default registerAs('meta', () => ({
  appId: process.env.META_APP_ID || '',
  appSecret: process.env.META_APP_SECRET || '',          // NUNCA exponer al frontend
  verifyToken: process.env.META_VERIFY_TOKEN || '',      // Token para verificar webhooks
  configId: process.env.META_CONFIG_ID || '',            // config_id del Facebook Login for Business
  graphVersion: process.env.META_GRAPH_VERSION || 'v21.0',
  graphBaseUrl: 'https://graph.facebook.com',
  // Timeouts en ms
  exchangeTimeout: parseInt(process.env.META_EXCHANGE_TIMEOUT || '30000', 10),
  discoveryTimeout: parseInt(process.env.META_DISCOVERY_TIMEOUT || '20000', 10),
  webhookTimeout: parseInt(process.env.META_WEBHOOK_TIMEOUT || '15000', 10),
  // Retry config
  maxRetries: parseInt(process.env.META_MAX_RETRIES || '3', 10),
  retryDelay: parseInt(process.env.META_RETRY_DELAY || '1000', 10),   // ms, se duplica en cada retry
}));
