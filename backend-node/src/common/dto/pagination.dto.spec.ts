import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaginationQueryDto, paginate } from './pagination.dto';

describe('PaginationQueryDto', () => {
  function transformAndValidate(plain: Record<string, any>) {
    const dto = plainToInstance(PaginationQueryDto, plain);
    return { dto, errors: validate(dto) };
  }

  // ── Defaults ──

  it('should have default page=1', () => {
    const dto = new PaginationQueryDto();
    expect(dto.page).toBe(1);
  });

  it('should have default pageSize=20', () => {
    const dto = new PaginationQueryDto();
    expect(dto.pageSize).toBe(20);
  });

  it('should have default sortOrder=desc', () => {
    const dto = new PaginationQueryDto();
    expect(dto.sortOrder).toBe('desc');
  });

  it('should have undefined sortBy by default', () => {
    const dto = new PaginationQueryDto();
    expect(dto.sortBy).toBeUndefined();
  });

  // ── Transform from query strings ──

  it('should transform string page to number', () => {
    const { dto } = transformAndValidate({ page: '3' });
    expect(dto.page).toBe(3);
  });

  it('should transform string pageSize to number', () => {
    const { dto } = transformAndValidate({ pageSize: '50' });
    expect(dto.pageSize).toBe(50);
  });

  // ── Validation ──

  it('should pass validation with valid values', async () => {
    const { dto, errors } = transformAndValidate({
      page: '1',
      pageSize: '20',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
    const errs = await errors;
    expect(errs).toHaveLength(0);
    expect(dto.sortBy).toBe('createdAt');
    expect(dto.sortOrder).toBe('asc');
  });

  it('should fail validation when page < 1', async () => {
    const { errors } = transformAndValidate({ page: '0' });
    const errs = await errors;
    expect(errs.length).toBeGreaterThan(0);
  });

  it('should fail validation when pageSize < 1', async () => {
    const { errors } = transformAndValidate({ pageSize: '0' });
    const errs = await errors;
    expect(errs.length).toBeGreaterThan(0);
  });

  it('should fail validation when pageSize > 100', async () => {
    const { errors } = transformAndValidate({ pageSize: '101' });
    const errs = await errors;
    expect(errs.length).toBeGreaterThan(0);
  });

  it('should fail validation when page is not an integer', async () => {
    const { errors } = transformAndValidate({ page: '1.5' });
    const errs = await errors;
    expect(errs.length).toBeGreaterThan(0);
  });

  it('should pass validation with no values (all optional)', async () => {
    const { errors } = transformAndValidate({});
    const errs = await errors;
    expect(errs).toHaveLength(0);
  });

  it('should accept maximum pageSize of 100', async () => {
    const { errors } = transformAndValidate({ pageSize: '100' });
    const errs = await errors;
    expect(errs).toHaveLength(0);
  });

  it('should accept minimum page of 1', async () => {
    const { errors } = transformAndValidate({ page: '1' });
    const errs = await errors;
    expect(errs).toHaveLength(0);
  });
});

describe('paginate', () => {
  it('should return correct paginated result', () => {
    const items = [1, 2, 3];
    const query: PaginationQueryDto = {
      page: 2,
      pageSize: 10,
      sortOrder: 'desc',
    };
    const result = paginate(items, 25, query);

    expect(result.items).toEqual([1, 2, 3]);
    expect(result.total).toBe(25);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(3); // ceil(25/10)
  });

  it('should use defaults when query.page is undefined', () => {
    const query = { pageSize: 10 } as PaginationQueryDto;
    const result = paginate([], 0, query);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(0); // ceil(0/10)
  });

  it('should use defaults when query.pageSize is undefined', () => {
    const query = { page: 1 } as PaginationQueryDto;
    const result = paginate([], 100, query);

    expect(result.pageSize).toBe(20);
    expect(result.totalPages).toBe(5); // ceil(100/20)
  });

  it('should calculate totalPages correctly for exact division', () => {
    const query: PaginationQueryDto = {
      page: 1,
      pageSize: 5,
      sortOrder: 'desc',
    };
    const result = paginate([], 20, query);
    expect(result.totalPages).toBe(4);
  });

  it('should calculate totalPages correctly for non-exact division', () => {
    const query: PaginationQueryDto = {
      page: 1,
      pageSize: 5,
      sortOrder: 'desc',
    };
    const result = paginate([], 21, query);
    expect(result.totalPages).toBe(5); // ceil(21/5)
  });

  it('should handle zero total', () => {
    const query: PaginationQueryDto = {
      page: 1,
      pageSize: 20,
      sortOrder: 'desc',
    };
    const result = paginate([], 0, query);
    expect(result.totalPages).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('should use page=0 fallback to 1 when page is explicitly 0', () => {
    const query = { page: 0, pageSize: 10 } as PaginationQueryDto;
    const result = paginate([], 50, query);
    // 0 is falsy, so page || 1 = 1
    expect(result.page).toBe(1);
  });
});
