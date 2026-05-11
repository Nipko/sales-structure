import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EcommerceService } from './ecommerce.service';
import { EcommerceController } from './ecommerce.controller';

@Module({
    imports: [HttpModule],
    controllers: [EcommerceController],
    providers: [EcommerceService],
    exports: [EcommerceService],
})
export class EcommerceModule {}
