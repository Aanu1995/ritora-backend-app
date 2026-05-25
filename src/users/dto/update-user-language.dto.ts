import { IsIn } from 'class-validator';

export class UpdateUserLanguageDto {
  @IsIn(['en', 'sv', 'es'], { message: 'validation.language.unsupported' })
  preferredLanguage!: string;
}
