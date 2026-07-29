import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BALANCE_CHECKER_PORT } from './ports/balance-checker.port';
import { MockBalanceCheckerAdapter } from './adapters/mock-balance-checker.adapter';

@Global()
@Module({
  providers: [
    MockBalanceCheckerAdapter,
    {
      provide: BALANCE_CHECKER_PORT,
      inject: [ConfigService, MockBalanceCheckerAdapter],
      useFactory: (config: ConfigService, mock: MockBalanceCheckerAdapter) =>
        config.get<string>('billingDriver') === 'mock' ? mock : mock,
    },
  ],
  exports: [BALANCE_CHECKER_PORT],
})
export class BillingModule {}
