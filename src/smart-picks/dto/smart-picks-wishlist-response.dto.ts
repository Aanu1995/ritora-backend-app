import { ApiProperty } from '@nestjs/swagger';
import { SmartPicksWishlistItem } from '../smart-picks.types';

export class SmartPicksWishlistResponseDto {
  @ApiProperty()
  items: SmartPicksWishlistItem[];

  constructor(items: SmartPicksWishlistItem[]) {
    this.items = items;
  }
}
