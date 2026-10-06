import { Global, Module } from '@nestjs/common';
import { DataCryptoService } from './data-crypto.service';

@Global()
@Module({
  providers: [DataCryptoService],
  exports: [DataCryptoService],
})
export class DataCryptoModule {}
