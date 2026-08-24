import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EcommerceService } from './ecommerce.service';
import { EcommerceController } from './ecommerce.controller';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

@Module({
    imports: [HttpModule],
    controllers: [EcommerceController],
    providers: [EcommerceService, TenantSecretCryptoService],
    exports: [EcommerceService],
})
export class EcommerceModule {}
