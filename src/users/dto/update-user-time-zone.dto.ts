import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateUserTimeZoneDto {
  @IsString({ message: 'validation.timeZone.unsupported' })
  @IsNotEmpty({ message: 'validation.timeZone.unsupported' })
  @MaxLength(100, { message: 'validation.timeZone.unsupported' })
  timeZone!: string;
}
