import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { GetCustomersDto } from './dto/get-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { WebhooksService } from '../webhooks/webhooks.service';
import { serializeCustomer } from '../webhooks/payload-serializers/customer.serializer';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly webhooksService: WebhooksService,
  ) {}

  async create(merchantId: string, dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customerRepository.create({
      merchantId,
      email: this.normalizeEmail(dto.email),
      name: this.normalizeNullableString(dto.name),
      phone: this.normalizeNullableString(dto.phone),
      metadata: dto.metadata ?? null,
    });

    const saved = await this.saveWithoutDuplicateEmail(customer);
    await this.dispatchCustomerEvent('customer.created', saved);
    return saved;
  }

  async findAll(
    merchantId: string,
    dto: GetCustomersDto,
  ): Promise<PaginatedResult<Customer>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const query = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.merchantId = :merchantId', { merchantId })
      .andWhere('customer.deletedAt IS NULL');

    const search = dto.search?.trim();
    if (search) {
      query.andWhere(
        '(customer.email ILIKE :search OR customer.name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [data, total] = await query
      .orderBy('customer.createdAt', 'DESC')
      .addOrderBy('customer.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  async findOne(id: string, merchantId: string): Promise<Customer> {
    const customer = await this.customerRepository.findOneBy({
      id,
      merchantId,
      deletedAt: IsNull(),
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return customer;
  }

  async update(
    id: string,
    merchantId: string,
    dto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.findOne(id, merchantId);

    if (dto.email !== undefined) {
      customer.email = this.normalizeEmail(dto.email);
    }
    if (dto.name !== undefined) {
      customer.name = this.normalizeNullableString(dto.name);
    }
    if (dto.phone !== undefined) {
      customer.phone = this.normalizeNullableString(dto.phone);
    }
    if (dto.metadata !== undefined) {
      customer.metadata = dto.metadata;
    }

    const saved = await this.saveWithoutDuplicateEmail(customer);
    await this.dispatchCustomerEvent('customer.updated', saved);
    return saved;
  }

  async remove(id: string, merchantId: string): Promise<void> {
    const customer = await this.findOne(id, merchantId);
    await this.customerRepository.softDelete(customer.id);
    await this.dispatchCustomerEvent('customer.deleted', customer);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizeNullableString(
    value: string | null | undefined,
  ): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async saveWithoutDuplicateEmail(
    customer: Customer,
  ): Promise<Customer> {
    try {
      return await this.customerRepository.save(customer);
    } catch (error) {
      if (this.isUniqueEmailViolation(error)) {
        throw new ConflictException(
          'A customer with this email already exists for this merchant',
        );
      }
      throw error;
    }
  }

  private isUniqueEmailViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const driverError = (error as { driverError?: { code?: string } })
      .driverError;
    return driverError?.code === '23505';
  }

  private async dispatchCustomerEvent(event: string, customer: Customer): Promise<void> {
    try {
      const payload = serializeCustomer(customer);
      await this.webhooksService.dispatchEventToMerchant(customer.merchantId, event, payload);
    } catch {
      // Webhook delivery failures must not break the customer operation.
    }
  }
}
