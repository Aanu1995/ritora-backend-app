import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { MailModule } from '../mail/mail.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { AdminRootGuard } from './admin-root.guard';
import { AdminService } from './admin.service';
import { AdminAccount } from './entities/admin-account.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminSession } from './entities/admin-session.entity';

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
    TypeOrmModule.forFeature([AdminAccount, AdminAuditLog, AdminSession]),
    MailModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminJwtAuthGuard,
    AdminRootGuard,
    AdminService,
    OriginCheckGuard,
  ],
  exports: [AdminAuthService, AdminService],
})
export class AdminModule {}
