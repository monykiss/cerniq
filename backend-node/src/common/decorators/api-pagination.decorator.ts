import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

/**
 * @ApiPagination decorator — adds standard pagination query params to Swagger docs.
 * Use on any list endpoint that supports page/pageSize.
 *
 * Usage:
 *   @ApiPagination()
 *   @Get('institutions')
 *   async list(@Query('page') page = 1, @Query('pageSize') pageSize = 20) { ... }
 */
export function ApiPagination() {
  return applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      description: 'Page number (1-indexed)',
      example: 1,
    }),
    ApiQuery({
      name: 'pageSize',
      required: false,
      type: Number,
      description: 'Items per page (max 100)',
      example: 20,
    }),
    ApiQuery({
      name: 'sortBy',
      required: false,
      type: String,
      description: 'Sort field',
      example: 'createdAt',
    }),
    ApiQuery({
      name: 'sortOrder',
      required: false,
      enum: ['asc', 'desc'],
      description: 'Sort direction',
    }),
  );
}
