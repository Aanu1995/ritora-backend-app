import { IsIn } from 'class-validator';

export class UpdateUserLanguageDto {
  @IsIn(['en', 'sv'], { message: 'validation.language.unsupported' })
  preferredLanguage!: string;
}
