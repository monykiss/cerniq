import { UserThrottleGuard } from './user-throttle.guard';

describe('UserThrottleGuard', () => {
  let guard: UserThrottleGuard;

  beforeEach(() => {
    // UserThrottleGuard extends ThrottlerGuard which requires dependencies.
    // We test getTracker directly by creating a minimal instance.
    guard = Object.create(UserThrottleGuard.prototype);
  });

  it('should return user ID tracker when user.userId is present', async () => {
    const req = { user: { userId: 'user-123' }, ip: '10.0.0.1' } as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('user:user-123');
  });

  it('should return user ID tracker when user.sub is present', async () => {
    const req = { user: { sub: 'sub-abc' }, ip: '10.0.0.1' } as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('user:sub-abc');
  });

  it('should return user ID tracker when user.id is present', async () => {
    const req = { user: { id: 'id-xyz' }, ip: '10.0.0.1' } as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('user:id-xyz');
  });

  it('should prefer userId over sub and id', async () => {
    const req = {
      user: { userId: 'preferred', sub: 'not-this', id: 'nor-this' },
      ip: '10.0.0.1',
    } as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('user:preferred');
  });

  it('should fall back to IP when no user is present', async () => {
    const req = { ip: '192.168.1.1' } as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('192.168.1.1');
  });

  it('should fall back to connection.remoteAddress when no IP', async () => {
    const req = { connection: { remoteAddress: '10.0.0.5' } } as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('10.0.0.5');
  });

  it('should return "unknown" when no user and no IP', async () => {
    const req = {} as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('unknown');
  });

  it('should fall back to IP when user object has no identifiers', async () => {
    const req = { user: { email: 'test@test.com' }, ip: '1.2.3.4' } as any;
    const result = await guard['getTracker'](req);
    expect(result).toBe('1.2.3.4');
  });
});
