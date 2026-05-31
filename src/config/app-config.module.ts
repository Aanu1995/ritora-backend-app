import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appEnvFilePaths, loadEnvFiles } from './env-files';
import { envValidationSchema } from './env.validation';

loadEnvFiles(appEnvFilePaths());

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true,
      },
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
