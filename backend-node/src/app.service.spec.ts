import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getHello returns Hello World!', () => {
    expect(service.getHello()).toBe('Hello World!');
  });

  it('getHello returns a string', () => {
    const result = service.getHello();
    expect(typeof result).toBe('string');
  });

  it('getHello is idempotent', () => {
    expect(service.getHello()).toBe(service.getHello());
  });

  it('getHello does not return empty string', () => {
    expect(service.getHello().length).toBeGreaterThan(0);
  });
});
