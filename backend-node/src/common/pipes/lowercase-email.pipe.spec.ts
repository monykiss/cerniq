import { LowercaseEmailPipe } from './lowercase-email.pipe';

describe('LowercaseEmailPipe', () => {
  let pipe: LowercaseEmailPipe;

  beforeEach(() => {
    pipe = new LowercaseEmailPipe();
  });

  it('should lowercase a valid email string', () => {
    expect(pipe.transform('User@Example.COM')).toBe('user@example.com');
  });

  it('should not modify a non-email string', () => {
    expect(pipe.transform('Hello World')).toBe('Hello World');
  });

  it('should return non-string primitives unchanged', () => {
    expect(pipe.transform(42)).toBe(42);
    expect(pipe.transform(true)).toBe(true);
    expect(pipe.transform(null)).toBeNull();
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it('should lowercase email fields in objects', () => {
    const result = pipe.transform({
      email: 'JOHN@EXAMPLE.COM',
      name: 'John',
    });
    expect(result.email).toBe('john@example.com');
    expect(result.name).toBe('John');
  });

  it('should lowercase userEmail field in objects', () => {
    const result = pipe.transform({
      userEmail: 'ADMIN@Test.Org',
      role: 'admin',
    });
    expect(result.userEmail).toBe('admin@test.org');
    expect(result.role).toBe('admin');
  });

  it('should lowercase contactEmail field in objects', () => {
    const result = pipe.transform({
      contactEmail: 'Support@CORP.CO',
    });
    expect(result.contactEmail).toBe('support@corp.co');
  });

  it('should lowercase workEmail field in objects', () => {
    const result = pipe.transform({
      workEmail: 'Employee@Work.COM',
    });
    expect(result.workEmail).toBe('employee@work.com');
  });

  it('should not modify non-email fields in objects', () => {
    const result = pipe.transform({
      email: 'USER@TEST.COM',
      firstName: 'JOHN',
      username: 'JOHNDOE',
    });
    expect(result.email).toBe('user@test.com');
    expect(result.firstName).toBe('JOHN');
    expect(result.username).toBe('JOHNDOE');
  });

  it('should trim email fields while lowercasing', () => {
    const result = pipe.transform({
      email: '  SPACED@test.com  ',
    });
    expect(result.email).toBe('spaced@test.com');
  });

  it('should return arrays unchanged', () => {
    const arr = ['a', 'b'];
    expect(pipe.transform(arr)).toEqual(arr);
  });

  it('should handle empty objects', () => {
    const result = pipe.transform({});
    expect(result).toEqual({});
  });

  it('should handle object with multiple email fields', () => {
    const result = pipe.transform({
      email: 'A@B.COM',
      userEmail: 'C@D.COM',
      contactEmail: 'E@F.COM',
      workEmail: 'G@H.COM',
    });
    expect(result.email).toBe('a@b.com');
    expect(result.userEmail).toBe('c@d.com');
    expect(result.contactEmail).toBe('e@f.com');
    expect(result.workEmail).toBe('g@h.com');
  });
});
