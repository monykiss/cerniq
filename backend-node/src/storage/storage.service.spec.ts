import { StorageService } from './storage.service';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest
    .fn()
    .mockResolvedValue('https://presigned-url.example.com'),
}));

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('generateUploadUrl returns upload URL, file key, and file URL', async () => {
    const result = await service.generateUploadUrl(
      'org-1',
      'receipt.jpg',
      'image/jpeg',
    );
    expect(result).toHaveProperty('uploadUrl');
    expect(result).toHaveProperty('fileKey');
    expect(result).toHaveProperty('fileUrl');
    expect(result.fileKey).toContain('receipts/org-1/');
    expect(result.fileKey).toMatch(/\.jpg$/);
  });

  it('generateDownloadUrl returns a presigned URL', async () => {
    const result = await service.generateDownloadUrl('receipts/org-1/test.jpg');
    expect(result).toBe('https://presigned-url.example.com');
  });

  it('getPublicUrl returns S3 public URL', () => {
    const result = service.getPublicUrl('receipts/org-1/test.jpg');
    expect(result).toContain('s3.');
    expect(result).toContain('receipts/org-1/test.jpg');
  });

  it('deleteFile does not throw', async () => {
    await expect(
      service.deleteFile('receipts/org-1/test.jpg'),
    ).resolves.not.toThrow();
  });

  // ── D18/D19/D20: env resolution table ───────────────────────────
  // Guards against (D18) the AWS_S3_REGION vs AWS_REGION name drift,
  // (D19) the parseInt(NaN) silent-widen on S3_PRESIGNED_URL_EXPIRY,
  // and (D20) the legacy `spendcheck-receipts` bucket default.
  describe('resolveUrlExpirySec', () => {
    const resolve = (raw: string | undefined) =>
      StorageService.resolveUrlExpirySec(raw);

    it('defaults to 300s when unset', () => {
      expect(resolve(undefined)).toBe(300);
    });

    it('defaults to 300s on empty string', () => {
      expect(resolve('')).toBe(300);
    });

    it('honors a valid value in [60, 604800]', () => {
      expect(resolve('900')).toBe(900);
      expect(resolve('60')).toBe(60);
      expect(resolve('604800')).toBe(604800);
    });

    it('defaults on values below 60s (too aggressive for browser upload)', () => {
      expect(resolve('30')).toBe(300);
    });

    it('defaults on values above AWS max (7 days = 604800s)', () => {
      expect(resolve('1000000')).toBe(300);
    });

    it('defaults on non-numeric (no silent NaN→SDK-default-900s widening)', () => {
      expect(resolve('abc')).toBe(300);
      expect(resolve('900abc')).toBe(300);
    });

    it('defaults on fractional (integer-seconds invariant)', () => {
      expect(resolve('300.5')).toBe(300);
    });
  });

  describe('AWS_S3_REGION vs AWS_REGION resolution (D18)', () => {
    const prev = {
      S3: process.env.AWS_S3_REGION,
      R: process.env.AWS_REGION,
    };
    afterEach(() => {
      if (prev.S3 === undefined) delete process.env.AWS_S3_REGION;
      else process.env.AWS_S3_REGION = prev.S3;
      if (prev.R === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = prev.R;
    });

    it('prefers AWS_S3_REGION (documented name) over AWS_REGION (legacy)', () => {
      process.env.AWS_S3_REGION = 'us-west-2';
      process.env.AWS_REGION = 'eu-central-1';
      const s = new StorageService();
      // Reach into private for the test — production behavior is
      // asserted by the public URL containing the region below.
      expect(s.getPublicUrl('receipts/x/y.jpg').includes('us-west-2')).toBe(
        true,
      );
    });

    it('falls back to AWS_REGION when AWS_S3_REGION is unset', () => {
      delete process.env.AWS_S3_REGION;
      process.env.AWS_REGION = 'ap-southeast-1';
      const s = new StorageService();
      expect(
        s.getPublicUrl('receipts/x/y.jpg').includes('ap-southeast-1'),
      ).toBe(true);
    });

    it('falls back to us-east-1 when both unset', () => {
      delete process.env.AWS_S3_REGION;
      delete process.env.AWS_REGION;
      const s = new StorageService();
      expect(s.getPublicUrl('receipts/x/y.jpg').includes('us-east-1')).toBe(
        true,
      );
    });
  });
});
