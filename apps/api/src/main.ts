// Sentry must be imported before anything else
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import helmet from 'helmet';
import { AppModule } from './app.module';

// PostgreSQL COUNT(*) returns BigInt which JSON.stringify cannot serialize
(BigInt.prototype as any).toJSON = function () { return Number(this); };

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bufferLogs: true,
        rawBody: true,
    });

    // Use Pino structured logger globally
    app.useLogger(app.get(Logger));

    // Security — disable Helmet CSP for Bull Board route (needs inline scripts)
    app.use((req: any, res: any, next: any) => {
        if (req.url?.startsWith('/api/v1/admin/queues')) return next();
        helmet({
            crossOriginResourcePolicy: { policy: 'cross-origin' },
        })(req, res, next);
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

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);

    // Protect Bull Board with token
    const bullBoardToken = process.env.BULL_BOARD_TOKEN || 'parallly-queues-2026';
    app.use('/api/v1/admin/queues', (req: any, res: any, next: any) => {
        if (req.query?.token !== bullBoardToken && req.headers?.['x-admin-token'] !== bullBoardToken) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        next();
    });

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`🚀 Parallext Engine API running on port ${port}`);
    console.log(`📚 API Docs: http://localhost:${port}/docs`);
}

bootstrap();
