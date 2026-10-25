import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployerBillingController } from './employer-billing.controller';
import { EmployerBillingService } from './employer-billing.service';
import { EmployerUnlock } from './entities/employer-unlock.entity';
import { EmployerWallet } from './entities/employer-wallet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EmployerWallet, EmployerUnlock])],
  controllers: [EmployerBillingController],
  providers: [EmployerBillingService],
  exports: [EmployerBillingService],
})
export class EmployerBillingModule {}
