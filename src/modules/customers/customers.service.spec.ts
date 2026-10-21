import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Customer } from './customer.entity';
import { Repository } from 'typeorm';

describe('CustomersService', () => {
  let service: CustomersService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let queryBuilder: Record<string, jest.Mock>;
  let webhooksService: { dispatchEventToMerchant: jest.Mock };

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    repository = {
      create: jest.fn((data) => data as Customer),
      save: jest.fn((customer) => Promise.resolve(customer)),
      findOneBy: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    webhooksService = {
      dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
    };
    service = new CustomersService(
      repository as unknown as Repository<Customer>,
      webhooksService as any,
    );
  });

  it('creates a customer for the authenticated merchant and normalizes email', async () => {
    const result = await service.create('merchant-1', {
      email: '  Jane.Doe@Example.COM ',
      name: ' Jane Doe ',
      phone: null,
      metadata: { tier: 'gold' },
    });

    expect(repository.create).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
      phone: null,
      metadata: { tier: 'gold' },
    });
    expect(result.merchantId).toBe('merchant-1');
  });

  it('dispatches customer.created after creating a customer', async () => {
    await service.create('merchant-1', {
      email: 'jane@example.com',
      name: 'Jane',
      metadata: { tier: 'gold' },
    });

    expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
      'merchant-1',
      'customer.created',
      expect.objectContaining({
        email: 'jane@example.com',
        name: 'Jane',
        metadata: { tier: 'gold' },
      }),
    );
  });

  it('maps a case-insensitive unique-index violation to ConflictException', async () => {
    repository.save.mockRejectedValueOnce({
      driverError: { code: '23505' },
    });

    await expect(
      service.create('merchant-1', { email: 'jane@example.com' }),
    ).rejects.toThrow(ConflictException);
  });

  it('does not dispatch customer.created when save throws', async () => {
    repository.save.mockRejectedValueOnce({
      driverError: { code: '23505' },
    });

    await expect(
      service.create('merchant-1', { email: 'jane@example.com' }),
    ).rejects.toThrow(ConflictException);

    expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
  });

  it('lists only active customers for the merchant with search and pagination', async () => {
    const customers = [{ id: 'customer-1' } as Customer];
    queryBuilder.getManyAndCount.mockResolvedValueOnce([customers, 1]);

    const result = await service.findAll('merchant-1', {
      page: 2,
      limit: 10,
      search: 'jane',
    });

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'customer.merchantId = :merchantId',
      { merchantId: 'merchant-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'customer.deletedAt IS NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(customer.email ILIKE :search OR customer.name ILIKE :search)',
      { search: '%jane%' },
    );
    expect(queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      data: customers,
      total: 1,
      page: 2,
      limit: 10,
    });
  });

  it('does not expose a customer owned by another merchant', async () => {
    repository.findOneBy.mockResolvedValueOnce(null);

    await expect(service.findOne('customer-1', 'merchant-2')).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'customer-1',
        merchantId: 'merchant-2',
      }),
    );
  });

  it('updates an owned customer', async () => {
    repository.findOneBy.mockResolvedValueOnce({
      id: 'customer-1',
      merchantId: 'merchant-1',
      email: 'old@example.com',
      name: 'Old Name',
      phone: null,
      metadata: null,
    });

    const result = await service.update('customer-1', 'merchant-1', {
      email: 'NEW@EXAMPLE.COM',
      name: null,
      metadata: { vip: true },
    });

    expect(result.email).toBe('new@example.com');
    expect(result.name).toBeNull();
    expect(result.metadata).toEqual({ vip: true });
  });

  it('dispatches customer.updated after updating a customer', async () => {
    repository.findOneBy.mockResolvedValueOnce({
      id: 'customer-1',
      merchantId: 'merchant-1',
      email: 'old@example.com',
      name: 'Old Name',
      phone: null,
      metadata: null,
    });

    await service.update('customer-1', 'merchant-1', {
      email: 'new@example.com',
    });

    expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
      'merchant-1',
      'customer.updated',
      expect.objectContaining({
        customerId: 'customer-1',
        email: 'new@example.com',
      }),
    );
  });

  it('soft-deletes only after confirming ownership', async () => {
    repository.findOneBy.mockResolvedValueOnce({
      id: 'customer-1',
      merchantId: 'merchant-1',
    });

    await service.remove('customer-1', 'merchant-1');

    expect(repository.softDelete).toHaveBeenCalledWith('customer-1');
  });

  it('dispatches customer.deleted after soft-deleting a customer', async () => {
    repository.findOneBy.mockResolvedValueOnce({
      id: 'customer-1',
      merchantId: 'merchant-1',
      email: 'jane@example.com',
    });

    await service.remove('customer-1', 'merchant-1');

    expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
      'merchant-1',
      'customer.deleted',
      expect.objectContaining({
        customerId: 'customer-1',
        email: 'jane@example.com',
      }),
    );
  });

  it('includes metadata and timestamps in the webhook payload', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    repository.save.mockResolvedValueOnce({
      id: 'cust-42',
      merchantId: 'merchant-1',
      email: 'jane@example.com',
      name: 'Jane',
      phone: '+1234567890',
      metadata: { plan: 'pro' },
      createdAt,
      updatedAt,
      deletedAt: null,
    });

    await service.create('merchant-1', {
      email: 'jane@example.com',
      name: 'Jane',
    });

    const payload = webhooksService.dispatchEventToMerchant.mock.calls[0][2];
    expect(payload).toEqual({
      customerId: 'cust-42',
      merchantId: 'merchant-1',
      email: 'jane@example.com',
      name: 'Jane',
      phone: '+1234567890',
      metadata: { plan: 'pro' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });
});
