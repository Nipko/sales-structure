import { Module } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { PersonaController } from './persona.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [TenantsModule],
    controllers: [PersonaController],
    providers: [PersonaService],
    exports: [PersonaService],
})
export class PersonaModule { }
