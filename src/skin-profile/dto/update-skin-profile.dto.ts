import { PartialType } from '@nestjs/swagger';
import { CreateSkinProfileDto } from './create-skin-profile.dto';

export class UpdateSkinProfileDto extends PartialType(CreateSkinProfileDto) {}
