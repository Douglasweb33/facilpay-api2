import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './customer.entity';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerPortalService } from './customer-portal.service';
import { PublicCustomerPortalController } from './public-customer-portal.controller';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { RecurringPayment } from '../payments/recurring-payment.entity';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Customer, Invoice, Payment, RecurringPayment]),
  ],
  controllers: [CustomersController, PublicCustomerPortalController],
  providers: [CustomersService, CustomerPortalService],
  exports: [CustomersService],
})
export class CustomersModule {}
