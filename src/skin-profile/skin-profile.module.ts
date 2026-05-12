import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmartPicksModule } from '../smart-picks/smart-picks.module';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { SkinProfile } from './entities/skin-profile.entity';
import { SkinProfileController } from './skin-profile.controller';
import { SkinProfileService } from './skin-profile.service';

@Module({
  imports: [
    SmartPicksModule,
    TypeOrmModule.forFeature([SkinProfile, UserConsent]),
    UsersModule,
  ],
  controllers: [SkinProfileController],
  providers: [SkinProfileService],
})
export class SkinProfileModule {}
