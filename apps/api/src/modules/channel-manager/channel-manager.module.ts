import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChannelManagerService } from './channel-manager.service';
import { ChannelManagerController } from './channel-manager.controller';
import { ChannelManagerSyncService } from './channel-manager-sync.service';
import { LodgingSourceOfTruthService } from './lodging-source-of-truth.service';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

@Module({
    imports: [HttpModule],
    controllers: [ChannelManagerController],
    providers: [
        ChannelManagerService,
        ChannelManagerSyncService,
        LodgingSourceOfTruthService,
        TenantSecretCryptoService,
    ],
    exports: [ChannelManagerService, LodgingSourceOfTruthService],
})
export class ChannelManagerModule {}
