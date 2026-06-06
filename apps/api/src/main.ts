// Sentry must be imported before anything else
import './instrument';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PublicApiModule } from './modules/public-api/public-api.module';

// PostgreSQL COUNT(*) returns BigInt which JSON.stringify cannot serialize
(BigInt.prototype as any).toJSON = function () { return Number(this); };

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true,
        rawBody: true,
    });

    // Raise body size limits (default is 100kb) — large payloads like media
    // base64, KB documents (PDF/DOCX uploaded as base64 → ~33% larger than the raw
    // file), broadcast recipient lists, etc. would 413 otherwise. Kept in sync with
    // nginx `client_max_body_size 50M` so uploads aren't rejected by a lower Express
    // cap (a ~7MB PDF already exceeded the previous 10mb limit once base64-encoded).
    // useBodyParser preserves rawBody (needed for Meta/MercadoPago signature checks).
    const BODY_LIMIT = process.env.BODY_SIZE_LIMIT || '50mb';
    app.useBodyParser('json', { limit: BODY_LIMIT });
    app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

    // Use Pino structured logger globally
    app.useLogger(app.get(Logger));

    // Security — disable Helmet CSP for Bull Board route (needs inline scripts)
    app.use((req: any, res: any, next: any) => {
        if (req.url?.startsWith('/api/v1/admin/queues')) return next();
        helmet({
            crossOriginResourcePolicy: { policy: 'cross-origin' },
        })(req, res, next);
    });
    // Widget public endpoints — permissive CORS (embedded on customer sites)
    app.use((req: any, res: any, next: any) => {
        if (req.url?.startsWith('/api/v1/widget')) {
            const origin = req.headers.origin || '*';
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.statusCode = 204;
                return res.end();
            }
        }
        next();
    });

    // Public API CORS — permissive (external integrations)
    app.use((req: any, res: any, next: any) => {
        if (req.url?.startsWith('/api/v1/public')) {
            const origin = req.headers.origin || '*';
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
            if (req.method === 'OPTIONS') {
                res.statusCode = 204;
                return res.end();
            }
        }
        next();
    });

    app.enableCors({
        origin: [
            process.env.DASHBOARD_URL || 'http://localhost:3001',
            'https://admin.parallly-chat.cloud',
            'https://parallly-chat.cloud',
            'http://localhost:3001',
        ].filter(Boolean),
        credentials: true,
    });

    // Global validation pipe
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            transformOptions: { enableImplicitConversion: true },
        }),
    );

    // API prefix
    app.setGlobalPrefix('api/v1');

    // Swagger documentation
    const config = new DocumentBuilder()
        .setTitle('Parallext Engine API')
        .setDescription('Multi-tenant conversational AI platform API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .addTag('auth', 'Authentication & Authorization')
        .addTag('tenants', 'Tenant Management')
        .addTag('channels', 'Channel & Messaging Gateway')
        .addTag('conversations', 'Conversation Management')
        .addTag('ai', 'AI & LLM Operations')
        .addTag('knowledge', 'Knowledge Base & RAG')
        .addTag('persona', 'Persona Configuration')
        .addTag('products', 'Product & Inventory')
        .addTag('orders', 'Orders & Reservations')
        .addTag('analytics', 'Analytics & Reporting')
        .build();

    if (process.env.NODE_ENV !== 'production') {
        const document = SwaggerModule.createDocument(app, config);
        SwaggerModule.setup('docs', app, document);
    }

    // Public API Swagger — available in all environments
    const publicApiConfig = new DocumentBuilder()
        .setTitle('Parallly Public API')
        .setDescription('REST API for integrations, Zapier, and custom workflows')
        .setVersion('1.0.0')
        .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
        .addTag('public-api', 'Public API endpoints')
        .addTag('public-api-keys', 'API key management')
        .build();
    const publicDocument = SwaggerModule.createDocument(app, publicApiConfig, {
        include: [PublicApiModule],
    });
    SwaggerModule.setup('docs/public', app, publicDocument);

    // Protect Bull Board with token (allow static assets through)
    const bullBoardToken = process.env.BULL_BOARD_TOKEN;
    if (!bullBoardToken) {
        console.warn('BULL_BOARD_TOKEN not set — Bull Board dashboard disabled');
    }
    app.use('/api/v1/admin/queues', (req: any, res: any, next: any) => {
        if (!bullBoardToken) {
            return res.status(503).json({ message: 'Bull Board disabled — BULL_BOARD_TOKEN not configured' });
        }
        // Allow static assets (JS, CSS, images) without auth
        if (req.url?.includes('/static/') || req.url?.endsWith('.js') || req.url?.endsWith('.css') || req.url?.endsWith('.svg')) {
            return next();
        }
        if (req.query?.token !== bullBoardToken && req.headers?.['x-admin-token'] !== bullBoardToken) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        next();
    });

    // Graceful shutdown — let in-flight requests finish before exiting
    app.enableShutdownHooks();

    const server = app.getHttpServer();
    const shutdown = async (signal: string) => {
        console.log(`\n${signal} received — draining connections...`);
        server.close(() => {
            console.log('HTTP server closed');
        });
        // Give in-flight requests up to 10s to finish
        setTimeout(async () => {
            await app.close();
            process.exit(0);
        }, 10_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`🚀 Parallext Engine API running on port ${port}`);
    console.log(`📚 API Docs: http://localhost:${port}/docs`);
}

bootstrap();
