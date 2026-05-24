import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { AdminSession } from '../admin/entities/admin-session.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { InAppNotification } from '../notifications/entities/in-app-notification.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import {
  AdminCommunityController,
  CommunityController,
} from './community.controller';
import { CommunityAiModerationService } from './community-ai-moderation.service';
import { CommunitySafetyService } from './community-safety.service';
import { CommunityService } from './community.service';
import { CommunityHelpfulnessVoteEntity } from './entities/community-helpfulness-vote.entity';
import { CommunityModerationDecision } from './entities/community-moderation-decision.entity';
import { CommunityOutcomeSignalVote } from './entities/community-outcome-signal-vote.entity';
import { CommunityProfile } from './entities/community-profile.entity';
import { CommunityReport } from './entities/community-report.entity';
import { CommunityReviewContextProduct } from './entities/community-review-context-product.entity';
import { CommunityReview } from './entities/community-review.entity';
import { CommunityRoutineAdaptation } from './entities/community-routine-adaptation.entity';
import { CommunityRoutineStep } from './entities/community-routine-step.entity';
import { CommunityRoutine } from './entities/community-routine.entity';
import { CommunitySafetyScanResult } from './entities/community-safety-scan-result.entity';
import { CommunitySettings } from './entities/community-settings.entity';
import { CommunityWarning } from './entities/community-warning.entity';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          audience: configService.getOrThrow<string>('JWT_AUDIENCE'),
          issuer: configService.getOrThrow<string>('JWT_ISSUER'),
        },
      }),
    }),
    TypeOrmModule.forFeature([
      CommunityProfile,
      CommunityRoutine,
      CommunityRoutineStep,
      CommunityReview,
      CommunityReviewContextProduct,
      CommunityReport,
      CommunityModerationDecision,
      CommunityHelpfulnessVoteEntity,
      CommunityOutcomeSignalVote,
      CommunityRoutineAdaptation,
      CommunitySafetyScanResult,
      CommunitySettings,
      CommunityWarning,
      AdminAuditLog,
      AdminSession,
      InAppNotification,
      SkinProfile,
      InventoryProduct,
      User,
      UserConsent,
    ]),
  ],
  controllers: [CommunityController, AdminCommunityController],
  providers: [
    CommunityService,
    CommunitySafetyService,
    CommunityAiModerationService,
  ],
})
export class CommunityModule {}
