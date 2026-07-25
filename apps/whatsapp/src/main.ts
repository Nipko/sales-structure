import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('WhatsAppService');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS — permite requests desde el dashboard
  app.enableCors({
    origin: process.env.DASHBOARD_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Swagger (solo en desarrollo)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Parallext WhatsApp Service')
      .setDescription('Onboarding de clientes a WhatsApp Business Cloud API via Embedded Signup v4')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    logger.log('Swagger docs available at /docs');
  }

  // Graceful shutdown. Sin esto, node (PID 1) IGNORA el SIGTERM de docker stop
  // y el contenedor muere por SIGKILL a los 10s con webhooks en vuelo: Meta ya
  // recibió su 200 y el payload aún no llegó a la cola — pérdida permanente.
  // Con el drain, las requests en curso terminan (el enqueue es ms) y los
  // workers de BullMQ cierran esperando sus jobs activos.
  app.enableShutdownHooks();
  const server = app.getHttpServer();
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — draining connections...`);
    server.close(() => logger.log('HTTP server closed'));
    setTimeout(async () => {
      await app.close();
      process.exit(0);
    }, 20_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const port = process.env.PORT || 3002;
  await app.listen(port);
  logger.log(`WhatsApp Service running on port ${port}`);
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
