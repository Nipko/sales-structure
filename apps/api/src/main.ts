// Sentry must be imported before anything else
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import helmet from 'helmet';
import { AppModule } from './app.module';

// PostgreSQL COUNT(*) returns BigInt which JSON.stringify cannot serialize
(BigInt.prototype as any).toJSON = function () { return Number(this); };

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        logger: ['error', 'warn', 'log', 'debug', 'verbose'],
        rawBody: true,
    });

    // Security
    app.use(helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow media embedding from dashboard
    }));
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

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`🚀 Parallext Engine API running on port ${port}`);
    console.log(`📚 API Docs: http://localhost:${port}/docs`);
}

bootstrap();
