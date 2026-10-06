/**
 * ReportStorageService tests — covers both unconfigured (no S3) and configured (mocked S3) paths.
 */

// Mock the AWS SDK modules before imports
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import { ReportStorageService } from './report-storage.service';

describe('ReportStorageService', () => {
  // ── Unconfigured (no S3 credentials) ───────────────────────────────

  describe('when storage is NOT configured', () => {
    let service: ReportStorageService;

    beforeEach(() => {
      // Clear env vars so S3 client is NOT initialized
      delete process.env.R2_ENDPOINT;
      delete process.env.AWS_S3_ENDPOINT;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      service = new ReportStorageService();
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('upload returns key without calling S3', async () => {
      const result = await service.upload(
        'reports/test.pdf',
        Buffer.from('test'),
      );
      expect(result).toBe('reports/test.pdf');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('getSignedUrl returns local API path when S3 not configured', async () => {
      const result = await service.getSignedUrl('reports/test.pdf');
      expect(result).toBe('/api/portal/reports/download/reports%2Ftest.pdf');
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('upload accepts custom content type', async () => {
      const result = await service.upload(
        'reports/data.csv',
        Buffer.from('a,b,c'),
        'text/csv',
      );
      expect(result).toBe('reports/data.csv');
    });

    it('getSignedUrl accepts custom expiry (still returns local path)', async () => {
      const result = await service.getSignedUrl('reports/test.pdf', 3600);
      expect(result).toBe('/api/portal/reports/download/reports%2Ftest.pdf');
    });

    // ── LRU + byte-cap eviction (local fallback mode) ──────────────────

    it('getLocalBuffer returns the stored buffer', async () => {
      await service.upload('reports/a.pdf', Buffer.from('alpha'));
      const result = service.getLocalBuffer('reports/a.pdf');
      expect(result?.toString()).toBe('alpha');
    });

    it('getLocalBuffer returns null for unknown key', () => {
      expect(service.getLocalBuffer('reports/nope.pdf')).toBeNull();
    });

    it('evicts LRU entry when count cap (MAX_LOCAL_BUFFERS=200) is exceeded', async () => {
      // Fill to exactly the cap, then read the first one to mark it recent,
      // then insert one more. The oldest un-read key must be evicted, not the
      // one we just touched — that's the LRU contract.
      for (let i = 0; i < 200; i++) {
        await service.upload(`reports/${i}.pdf`, Buffer.from(`p${i}`));
      }
      expect((service as any).localBuffers.size).toBe(200);

      // Touch key #0 so it becomes most-recently-used.
      expect(service.getLocalBuffer('reports/0.pdf')).not.toBeNull();

      // Adding the 201st entry must evict the oldest un-touched key (#1),
      // NOT the freshly-touched #0.
      await service.upload('reports/200.pdf', Buffer.from('fresh'));
      expect((service as any).localBuffers.size).toBe(200);
      expect(service.getLocalBuffer('reports/0.pdf')).not.toBeNull(); // kept (touched)
      expect(service.getLocalBuffer('reports/1.pdf')).toBeNull(); // evicted
      expect(service.getLocalBuffer('reports/200.pdf')).not.toBeNull(); // kept (newest)
    });

    it('evicts entries to honor byte cap even when count cap not hit', async () => {
      // Synthetic 300MB + 300MB inserts — byte cap is 512MB, so the second
      // insert must evict the first even though count is well under 200.
      const big = Buffer.alloc(300 * 1024 * 1024); // 300MB zero-filled
      await service.upload('reports/big1.pdf', big);
      expect(service.getLocalBuffer('reports/big1.pdf')).not.toBeNull();
      expect(service.getLocalBytes()).toBe(big.length);

      await service.upload('reports/big2.pdf', big);
      // The second insert pushed total past 512MB; big1 must have been evicted.
      expect(service.getLocalBuffer('reports/big1.pdf')).toBeNull();
      expect(service.getLocalBuffer('reports/big2.pdf')).not.toBeNull();
      expect(service.getLocalBytes()).toBe(big.length);
    });

    it('re-inserting the same key does not double-count bytes', async () => {
      const first = Buffer.from('first-version');
      const second = Buffer.from('second-version-longer');
      await service.upload('reports/same.pdf', first);
      await service.upload('reports/same.pdf', second);

      expect((service as any).localBuffers.size).toBe(1);
      expect(service.getLocalBytes()).toBe(second.length);
      expect(service.getLocalBuffer('reports/same.pdf')?.toString()).toBe(
        'second-version-longer',
      );
    });
  });

  // ── Configured (with S3/R2 credentials) ────────────────────────────

  describe('when storage IS configured', () => {
    let service: ReportStorageService;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.R2_ENDPOINT = 'https://r2.example.com';
      process.env.R2_ACCESS_KEY_ID = 'test-key-id';
      process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
      process.env.R2_BUCKET = 'test-bucket';
      service = new ReportStorageService();
    });

    afterEach(() => {
      delete process.env.R2_ENDPOINT;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_BUCKET;
    });

    it('initializes S3 client', () => {
      // The client is not null when credentials are provided
      expect((service as any).client).not.toBeNull();
    });

    it('upload sends PutObjectCommand to S3', async () => {
      mockSend.mockResolvedValue({});
      const buffer = Buffer.from('pdf content');
      const result = await service.upload('reports/q1-2024.pdf', buffer);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'reports/q1-2024.pdf',
        Body: buffer,
        ContentType: 'application/pdf',
      });
      expect(result).toBe('reports/q1-2024.pdf');
    });

    it('upload uses custom content type', async () => {
      mockSend.mockResolvedValue({});
      await service.upload('reports/data.csv', Buffer.from('a,b'), 'text/csv');

      const command = mockSend.mock.calls[0][0];
      expect(command.input.ContentType).toBe('text/csv');
    });

    it('upload defaults to application/pdf content type', async () => {
      mockSend.mockResolvedValue({});
      await service.upload('reports/report.pdf', Buffer.from('pdf'));

      const command = mockSend.mock.calls[0][0];
      expect(command.input.ContentType).toBe('application/pdf');
    });

    it('getSignedUrl generates a signed URL', async () => {
      mockGetSignedUrl.mockResolvedValue(
        'https://r2.example.com/signed?token=abc',
      );

      const result = await service.getSignedUrl('reports/test.pdf');

      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      expect(result).toBe('https://r2.example.com/signed?token=abc');
    });

    it('getSignedUrl uses custom expiry', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/signed');

      await service.getSignedUrl('reports/test.pdf', 7200);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 7200 },
      );
    });

    it('getSignedUrl defaults to 86400 second expiry', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/signed');

      await service.getSignedUrl('reports/test.pdf');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 86400 },
      );
    });

    it('uses AWS_S3_ENDPOINT as fallback', () => {
      // Clear ALL storage env vars first
      delete process.env.R2_ENDPOINT;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_BUCKET;
      delete process.env.AWS_S3_BUCKET;

      process.env.AWS_S3_ENDPOINT = 'https://s3.amazonaws.com';
      process.env.AWS_ACCESS_KEY_ID = 'aws-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
      process.env.AWS_S3_BUCKET = 'aws-bucket';

      const s = new ReportStorageService();
      expect((s as any).client).not.toBeNull();
      expect((s as any).bucket).toBe('aws-bucket');

      delete process.env.AWS_S3_ENDPOINT;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.AWS_S3_BUCKET;
    });

    it('defaults bucket to cerniq-reports', () => {
      delete process.env.R2_BUCKET;
      delete process.env.AWS_S3_BUCKET;
      const s = new ReportStorageService();
      expect((s as any).bucket).toBe('cerniq-reports');
    });
  });
});
