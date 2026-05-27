import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appEnvFilePaths } from './env-files';
import { envValidationSchema } from './env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: appEnvFilePaths(),
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true,
      },
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
