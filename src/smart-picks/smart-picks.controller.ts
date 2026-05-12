import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import {
  SmartPicksOverviewQueryDto,
  SmartPicksOverviewResponseDto,
  UpdateSmartPicksBudgetDto,
} from './dto/smart-picks-overview-response.dto';
import { SmartPicksWishlistResponseDto } from './dto/smart-picks-wishlist-response.dto';
import { SmartPicksOverviewService } from './services/smart-picks-overview.service';
import { SmartPicksWishlistService } from './services/smart-picks-wishlist.service';

@ApiBearerAuth()
@ApiTags('smart-picks')
@Controller('smart-picks')
export class SmartPicksController {
  constructor(
    private readonly overviewService: SmartPicksOverviewService,
    private readonly wishlistService: SmartPicksWishlistService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Smart Picks gap overview' })
  async getOverview(
    @CurrentUser() user: User,
    @Query() query: SmartPicksOverviewQueryDto,
  ): Promise<SmartPicksOverviewResponseDto> {
    return new SmartPicksOverviewResponseDto(
      await this.overviewService.getOverview(user, query.mode ?? null),
    );
  }

  @Get('wishlist')
  @ApiOperation({ summary: 'Saved Smart Picks product suggestions' })
  async getWishlist(
    @CurrentUser() user: User,
  ): Promise<SmartPicksWishlistResponseDto> {
    return new SmartPicksWishlistResponseDto(
      await this.wishlistService.list(user),
    );
  }

  @Delete('wishlist/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a saved Smart Picks product' })
  async removeWishlistItem(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<void> {
    await this.wishlistService.remove(user, id);
  }

  @Patch('budget')
  @ApiOperation({ summary: 'Update Smart Picks active budget tier' })
  async updateBudget(
    @CurrentUser() user: User,
    @Body() body: UpdateSmartPicksBudgetDto,
  ): Promise<SmartPicksOverviewResponseDto> {
    return new SmartPicksOverviewResponseDto(
      await this.overviewService.updateBudget(user, body.budgetTier),
    );
  }
}
