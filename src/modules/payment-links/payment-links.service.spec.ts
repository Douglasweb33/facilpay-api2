import { ForbiddenException } from '@nestjs/common';
import { PaymentLinksService } from './payment-links.service';

describe('PaymentLinksService merchant suspension', () => {
  it('blocks redemption for a suspended link owner', async () => {
    const link = {
      id: 'link-id',
      token: 'token',
      merchantId: 'merchant-id',
      isActive: true,
      expiresAt: null,
      views: 0,
    };
    const repo = {
      findOneBy: jest.fn().mockResolvedValue(link),
      increment: jest.fn().mockResolvedValue(undefined),
    };
    const usersService = {
      assertMerchantActive: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Merchant is suspended')),
    };
    const service = new PaymentLinksService(
      repo as any,
      {} as any,
      {} as any,
      { child: () => ({}) } as any,
      usersService as any,
    );

    await expect(service.redeemLink('token', {} as any)).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersService.assertMerchantActive).toHaveBeenCalledWith('merchant-id');
  });
});

describe('PaymentLinksService duplicate', () => {
  const source = {
    id: 'link-id',
    token: 'original-token',
    slug: 'original-slug',
    merchantId: 'merchant-id',
    amount: '25.00',
    flexibleAmount: false,
    minAmount: null,
    currency: 'USD',
    description: 'Original description',
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    maxCompletions: 5,
    requiredFields: { name: true, email: false, phone: false },
    customFields: [],
    successUrl: null,
    cancelUrl: null,
    isActive: false,
    views: 42,
    completions: 3,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  function createService() {
    const repo = {
      findOneBy: jest.fn().mockResolvedValue(source),
      create: jest.fn((value) => ({
        isActive: true,
        views: 0,
        completions: 0,
        ...value,
      })),
      save: jest.fn(async (value) => ({ id: 'new-id', ...value })),
    };
    const usersService = { assertMerchantActive: jest.fn() };
    const service = new PaymentLinksService(
      repo as any,
      {} as any,
      {} as any,
      { child: () => ({}) } as any,
      usersService as any,
    );
    return { repo, usersService, service };
  }

  it('copies configuration with a fresh token and reset identity and counters', async () => {
    const { repo, service } = createService();

    const result = await service.duplicate('link-id', 'merchant-id');
    const savedLink = repo.save.mock.calls[0][0];

    expect(result.id).toBe('new-id');
    expect(savedLink.token).toMatch(/^[a-f0-9]{32}$/);
    expect(savedLink.token).not.toBe(source.token);
    expect(savedLink.slug).toBeNull();
    expect(savedLink.views).toBe(0);
    expect(savedLink.completions).toBe(0);
    expect(savedLink.isActive).toBe(true);
    expect(savedLink.amount).toBe(25);
    expect(savedLink.maxCompletions).toBe(5);
    expect(savedLink.merchantId).toBe('merchant-id');
    expect(savedLink.id).toBeUndefined();
    expect(savedLink.createdAt).toBeUndefined();
    expect(savedLink.updatedAt).toBeUndefined();
  });

  it('applies overrides to copied configuration', async () => {
    const { repo, service } = createService();

    await service.duplicate('link-id', 'merchant-id', {
      amount: 40,
      description: 'Variant',
      slug: 'new-variant',
    });

    expect(repo.save.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        amount: 40,
        description: 'Variant',
        slug: 'new-variant',
      }),
    );
  });

  it('rejects duplicating another merchant payment link', async () => {
    const { service } = createService();

    await expect(
      service.duplicate('link-id', 'another-merchant'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('PaymentLinksService bulkDeactivate', () => {
  const merchantId = 'merchant-id';

  function createService(owned: Array<{ id: string; isActive: boolean }>) {
    const repo = {
      find: jest.fn().mockResolvedValue(owned.map((l) => ({ ...l, merchantId }))),
      update: jest.fn().mockResolvedValue({ affected: owned.length }),
    };
    const service = new PaymentLinksService(
      repo as any,
      {} as any,
      {} as any,
      { child: () => ({}) } as any,
      {} as any,
    );
    return { service, repo };
  }

  it('deactivates owned active links and returns per-id results', async () => {
    const { service, repo } = createService([
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
    ]);

    const result = await service.bulkDeactivate(['a', 'b', 'c'], merchantId);

    expect(repo.find).toHaveBeenCalledWith({
      where: { id: expect.anything(), merchantId },
    });
    expect(repo.update).toHaveBeenCalledTimes(1);
    const [criteria, patch] = repo.update.mock.calls[0];
    expect(criteria.merchantId).toBe(merchantId);
    expect(criteria.id.value).toEqual(['a']);
    expect(patch).toEqual({ isActive: false });

    expect(result).toEqual({
      results: [
        { id: 'a', status: 'deactivated' },
        { id: 'b', status: 'already_inactive' },
        { id: 'c', status: 'skipped', reason: 'Payment link not found' },
      ],
      deactivated: 1,
      skipped: 1,
    });
  });

  it('skips ids belonging to other merchants without updating anything', async () => {
    const { service, repo } = createService([]);

    const result = await service.bulkDeactivate(['foreign-id'], merchantId);

    expect(repo.update).not.toHaveBeenCalled();
    expect(result.results).toEqual([
      { id: 'foreign-id', status: 'skipped', reason: 'Payment link not found' },
    ]);
    expect(result.deactivated).toBe(0);
  });

  it('de-duplicates repeated ids', async () => {
    const { service } = createService([{ id: 'a', isActive: true }]);

    const result = await service.bulkDeactivate(['a', 'a', 'a'], merchantId);

    expect(result.results).toHaveLength(1);
    expect(result.deactivated).toBe(1);
  });

  it('rejects more than 100 ids', async () => {
    const { service, repo } = createService([]);
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);

    await expect(service.bulkDeactivate(ids, merchantId)).rejects.toThrow(
      'A maximum of 100 ids can be deactivated at once',
    );
    expect(repo.find).not.toHaveBeenCalled();
  });
});
