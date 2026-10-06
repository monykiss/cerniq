import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ReceiptParserService } from './receipt-parser.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [LlmService, ReceiptParserService],
  exports: [LlmService, ReceiptParserService],
})
export class LlmModule {}
