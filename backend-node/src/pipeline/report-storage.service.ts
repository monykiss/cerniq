import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class ReportStorageService {
  private readonly logger = new Logger(ReportStorageService.name);
  private client: S3Client | null = null;
  private bucket: string;

  /**
   * In-memory LRU buffer cache for local-mode (no R2 configured).
   * Keyed by storage key (e.g. "reports/{jobId}/report_es.pdf").
   *
   * Eviction policy: least-recently-used. A read via `getLocalBuffer()` bumps
   * the entry to most-recent; inserts evict the oldest entry when either
   * `MAX_LOCAL_BUFFERS` or `MAX_LOCAL_BYTES` is exceeded. Without LRU,
   * a popular report generated early could be evicted before it was downloaded
   * while 200 experimental runs sat warm, producing silent 404s.
   */
  private readonly localBuffers = new Map<string, Buffer>();
  private localBytes = 0;
  private static readonly MAX_LOCAL_BUFFERS = 200;
  /** 512 MiB — enough headroom that a handful of 10-50 MB PDFs can coexist with
   *  smaller artifacts, but bounded so a single test run can't balloon RSS. */
  private static readonly MAX_LOCAL_BYTES = 512 * 1024 * 1024;

  constructor() {
    const endpoint = process.env.R2_ENDPOINT || process.env.AWS_S3_ENDPOINT;
    const accessKeyId =
      process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    this.bucket =
      process.env.R2_BUCKET || process.env.AWS_S3_BUCKET || 'cerniq-reports';

    if (endpoint && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log('Report storage (S3/R2) initialized');
    } else {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'CRITICAL: R2/S3 storage not configured in production — reports will use volatile in-memory buffer. ' +
            'Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY to enable persistent storage.',
        );
      }
      this.logger.warn(
        'Report storage not configured — using in-memory buffer storage (not suitable for multi-instance deployment)',
      );
    }
  }

  /** Whether cloud storage (R2/S3) is configured. */
  get isCloudConfigured(): boolean {
    return this.client !== null;
  }

  async upload(
    key: string,
    buffer: Buffer,
    contentType = 'application/pdf',
  ): Promise<string> {
    if (!this.client) {
      // Local fallback: store buffer in memory and return an API-servable path.
      // Re-insert semantics: if the key already exists, remove it first so the
      // re-inserted entry sits at the end of the Map (most-recently-used).
      const existing = this.localBuffers.get(key);
      if (existing) {
        this.localBytes -= existing.length;
        this.localBuffers.delete(key);
      }
      this.localBuffers.set(key, buffer);
      this.localBytes += buffer.length;
      this.evictLRUIfNeeded();
      this.logger.warn(
        `Stored ${key} in memory (${(buffer.length / 1024).toFixed(0)}KB; ` +
          `cache: ${this.localBuffers.size} entries, ` +
          `${(this.localBytes / 1024 / 1024).toFixed(1)}MB) — R2 not configured`,
      );
      return key;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    this.logger.log({ event: 'report.uploaded', key });
    return key;
  }

  async getSignedUrl(key: string, expirySeconds = 86400): Promise<string> {
    if (!this.client) {
      // Local fallback: return an API path that the portal controller can serve
      return `/api/portal/reports/download/${encodeURIComponent(key)}`;
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expirySeconds },
    );
  }

  /**
   * Retrieve a locally-stored buffer by key. Returns null if not found
   * or if cloud storage is configured (use signed URLs instead).
   *
   * Touches the entry: a successful read moves the key to the most-recent
   * position in the LRU order so popular artifacts aren't evicted while cold
   * ones sit warm.
   */
  getLocalBuffer(key: string): Buffer | null {
    const buffer = this.localBuffers.get(key);
    if (!buffer) return null;
    // LRU touch — delete + re-set moves the key to the end of iteration order.
    this.localBuffers.delete(key);
    this.localBuffers.set(key, buffer);
    return buffer;
  }

  /** Evict least-recently-used entries until both count and byte caps are satisfied. */
  private evictLRUIfNeeded(): void {
    while (
      this.localBuffers.size > ReportStorageService.MAX_LOCAL_BUFFERS ||
      this.localBytes > ReportStorageService.MAX_LOCAL_BYTES
    ) {
      const oldest = this.localBuffers.keys().next().value;
      if (!oldest) break;
      const oldBuffer = this.localBuffers.get(oldest);
      this.localBuffers.delete(oldest);
      if (oldBuffer) this.localBytes -= oldBuffer.length;
    }
  }

  /** Test/ops introspection — total bytes currently held in the local cache. */
  getLocalBytes(): number {
    return this.localBytes;
  }
}
