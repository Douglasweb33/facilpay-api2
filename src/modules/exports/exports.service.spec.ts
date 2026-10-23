import { DataSource } from 'typeorm';
import {
  buildCsv,
  DatabaseExportsSource,
  EXPORT_COLUMNS,
  ExportType,
  sanitizeCsvCell,
} from './exports.service';

describe('exports source', () => {
  it.each<ExportType>([
    'payments',
    'customers',
    'invoices',
    'refunds',
    'ledger',
  ])(
    'streams merchant-scoped %s rows with its documented columns',
    async (resource) => {
      const query = jest.fn().mockResolvedValue([{ id: 'row-id' }]);
      const source = new DatabaseExportsSource({ query } as unknown as DataSource);
      const batches: Record<string, unknown>[][] = [];

      for await (const batch of source.streamRows(
        resource,
        { merchantId: 'merchant-id', currency: 'USD' },
        100,
      )) {
        batches.push(batch);
      }

      expect(batches).toEqual([[{ id: 'row-id' }]]);
      const sql = query.mock.calls[0][0];
      const merchantPredicate = {
        payments: 'p."merchantId" = $1',
        customers: 'c."merchantId" = $1',
        invoices: 'i."merchantId" = $1',
        refunds: 'p."merchantId" = $1',
        ledger: 'l."merchantId" = $1',
      }[resource];
      expect(sql).toContain(`WHERE ${merchantPredicate}`);
      expect(query.mock.calls[0][1][0]).toBe('merchant-id');
      expect(sql).toContain('LIMIT');
      for (const column of EXPORT_COLUMNS[resource]) {
        expect(sql).toContain(`"${column}"`);
      }
    },
  );

  it('applies invoice currency filters to the invoices table', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const source = new DatabaseExportsSource({ query } as unknown as DataSource);

    for await (const _batch of source.streamRows(
      'invoices',
      { merchantId: 'merchant-id', currency: 'USD' },
      100,
    )) {
      // No rows expected for this query.
    }

    expect(query.mock.calls[0][0]).toContain('i."currency" = $2');
    expect(query.mock.calls[0][1]).toEqual(['merchant-id', 'USD', 100, 0]);
  });

  it('applies ledger currency and date filters to the ledger table', async () => {
    const query = jest
      .fn<Promise<Record<string, unknown>[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const source = new DatabaseExportsSource({
      query,
    } as unknown as DataSource);
    const batches: Record<string, unknown>[][] = [];

    for await (const batch of source.streamRows(
      'ledger',
      {
        merchantId: 'merchant-id',
        currency: 'USD',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      },
      100,
    )) {
      batches.push(batch);
    }

    const [sql, params] = query.mock.calls[0];
    expect(batches).toEqual([]);
    expect(sql).toContain('FROM "ledger_entries" l');
    expect(sql).toContain('l."createdAt" >= $2');
    expect(sql).toContain('l."createdAt" < $3');
    expect(sql).toContain('l."currency" = $4');
    expect(params).toEqual([
      'merchant-id',
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      'USD',
      100,
      0,
    ]);
  });

  it('keeps signed numbers and dates usable in CSV while still neutralising formulas', () => {
    expect(sanitizeCsvCell('-92.50000000')).toBe('-92.50000000');
    expect(sanitizeCsvCell('-1+1')).toBe("'-1+1");
    expect(sanitizeCsvCell('+5')).toBe("'+5");
    expect(sanitizeCsvCell(new Date('2026-01-05T10:00:00.000Z'))).toBe(
      '2026-01-05T10:00:00.000Z',
    );
    expect(buildCsv(['id', 'amount'], [{ id: '@cmd', amount: '-3.10' }])).toBe(
      "id,amount\n'@cmd,-3.10\n",
    );
  });

  it('protects formula-leading values and escapes CSV delimiters', () => {
    expect(sanitizeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeCsvCell('name,"value"')).toBe('"name,""value"""');
    expect(sanitizeCsvCell(null)).toBe('');
  });
});