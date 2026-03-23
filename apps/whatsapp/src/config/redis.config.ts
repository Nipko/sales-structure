import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  // Prefijos de colas para namespacing dentro del Redis compartido
  queues: {
    onboarding: 'onboarding',     // wa:onboarding
    webhooks: 'webhooks',         // wa:webhooks
    sync: 'sync',                 // wa:sync
    ops: 'ops',                   // wa:ops
  },
}));
