import { Module, Global } from '@nestjs/common';
import { CacheService } from './cache.service';

@Global() // Make cache service available globally
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
