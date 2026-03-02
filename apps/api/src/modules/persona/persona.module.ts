import { Module } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [TenantsModule],
    providers: [PersonaService],
    exports: [PersonaService],
})
export class PersonaModule { }
