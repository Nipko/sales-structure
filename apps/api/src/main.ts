import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    // Security
    app.use(helmet());
    app.enableCors({
        origin: process.env.DASHBOARD_URL || 'http://localhost:3001',
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
