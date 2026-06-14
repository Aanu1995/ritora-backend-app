import { IsEnum } from 'class-validator';
import { ProductIntroductionStatus } from '../../shelf/shelf.types';

export class UpdateProductIntroductionDto {
  @IsEnum(ProductIntroductionStatus)
  status!: ProductIntroductionStatus;
}
