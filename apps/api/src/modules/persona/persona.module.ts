import { forwardRef, Module } from '@nestjs/common';
import { PersonaService } from './persona.service';
import { PersonaController } from './persona.controller';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
    imports: [forwardRef(() => TenantsModule)],
    controllers: [PersonaController],
    providers: [PersonaService],
    exports: [PersonaService],
})
export class PersonaModule { }
