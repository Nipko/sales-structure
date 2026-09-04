// Sentry must be imported before anything else
import './instrument';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PublicApiModule } from './modules/public-api/public-api.module';

// PostgreSQL COUNT(*) returns BigInt which JSON.stringify cannot serialize
(BigInt.prototype as any).toJSON = function () { return Number(this); };

export interface ValidationFieldError {
    /** Ruta del campo tal como viaja en el cuerpo: `company.email`, `plan`. */
    path: string;
    /** Nombre del validador que falló (`isEmail`, `isNotEmpty`, `maxLength`…). */
    constraint: string;
}

/**
 * Aplana los errores de class-validator, incluidos los anidados.
 *
 * El nombre del validador es un CÓDIGO estable: el panel lo traduce y lo
 * muestra bajo el campo. El texto crudo de class-validator viene en inglés y
 * con el nombre técnico de la propiedad ("company.email must be an email"), y
 * era lo único que veía alguien que se estaba registrando —en el último paso
 * del alta, sin ninguna pista de a qué campo volver.
 */
export function flattenValidationErrors(
    errors: ValidationError[],
    parentPath = '',
): ValidationFieldError[] {
    const fields: ValidationFieldError[] = [];
    for (const error of errors || []) {
        const path = parentPath ? `${parentPath}.${error.property}` : String(error.property);
        for (const constraint of Object.keys(error.constraints || {})) {
            fields.push({ path, constraint });
        }
        if (error.children?.length) {
            fields.push(...flattenValidationErrors(error.children, path));
        }
    }
    return fields;
}

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
    // Widget public endpoints — permissive CORS (embedded on customer sites).
    //
    // La lista es EXPLÍCITA a propósito. Antes era `startsWith('/api/v1/widget')`, que
    // por prefijo se tragaba también las rutas AUTENTICADAS vecinas:
    //   /api/v1/widgets/...          (CRUD del widget desde el dashboard)
    //   /api/v1/widget/triggers/...  (triggers proactivos)
    // porque "widgets" empieza con "widget". A esas les respondía el preflight con
    // `Allow-Headers: Content-Type` — sin `Authorization` — y cortaba el OPTIONS con
    // 204, así que el navegador bloqueaba toda llamada autenticada antes de enviarla.
    // Desde el servidor se veía perfecto (no llegaba ni una petición al log) y en la
    // UI se veía como "no tienes widgets". El Web Chat nunca funcionó desde el panel.
    const PUBLIC_WIDGET_ROUTES = /^\/api\/v1\/widget\/(loader\.js|config\/|sessions(\/|$|\?))/;
    app.use((req: any, res: any, next: any) => {
        if (PUBLIC_WIDGET_ROUTES.test(req.url || '')) {
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
            // Error tipado (sigue siendo 400): el panel mapea cada
            // `{ path, constraint }` a su mensaje en el idioma del usuario y
            // salta al paso donde vive el campo. `message` queda en español
            // para los clientes viejos que solo leen ese campo.
            exceptionFactory: (errors: ValidationError[]) => new BadRequestException({
                error: 'validation_failed',
                message: 'Revisá los datos: hay campos incompletos o con formato inválido.',
                fields: flattenValidationErrors(errors),
            }),
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
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n${signal} received — draining connections...`);

        // A CEILING, not a guillotine. The API intentionally keeps one inbound
        // consumer alive while the dedicated worker restarts. Its measured p99
        // is about 100s and the BullMQ lock is 120s, so the old 40s ceiling
        // killed a healthy turn during every deploy and consumed its only
        // stalled-job rescue. Docker gives this process 160s; 150s leaves a
        // final ten-second margin for the container runtime while still letting
        // Nest/BullMQ drain the active job.
        const shutdownGraceMs = 150_000;
        const hard = setTimeout(() => {
            console.error(`Forced exit after ${shutdownGraceMs / 1000}s — drain did not finish`);
            process.exit(1);
        }, shutdownGraceMs);
        hard.unref?.();

        server.close(() => console.log('HTTP server closed'));
        try {
            await app.close();
        } catch (err) {
            console.error('Error during graceful close:', err);
        }
        clearTimeout(hard);
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`🚀 Parallext Engine API running on port ${port}`);
    console.log(`📚 API Docs: http://localhost:${port}/docs`);
}

bootstrap();
