import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { IcalSyncService } from './src/modules/vacation-rental/ical-sync.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const syncService = app.get(IcalSyncService);
  
  // The schema name based on tenantId 6a3b44fd-12fb-4a4f-87f9-eabe1f3bb49a is likely tenant_6a3b44fd_12fb_4a4f_87f9_eabe1f3bb49a or similar
  const prisma = app.get('PrismaService');
  const tenant = await prisma.$queryRawUnsafe(`SELECT schema_name FROM tenants WHERE id = '6a3b44fd-12fb-4a4f-87f9-eabe1f3bb49a'`);
  const schemaName = tenant[0]?.schema_name;
  
  console.log('Schema:', schemaName);
  
  console.log('Syncing Booking.com...');
  await syncService.syncFeed(schemaName, 'eaec8318-bcdc-4ef1-9167-c01664cc01a5');
  
  console.log('Syncing Airbnb...');
  await syncService.syncFeed(schemaName, '85a749ad-dc79-4f85-ba88-00b2dec86da5');
  
  await app.close();
}
bootstrap();
