import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

export interface UploadUrlResponse {
  uploadUrl: string;
  fileKey: string;
  fileUrl: string;
}

// Default presigned URL lifetime in seconds. AWS SDK default is 900
// (15 min); CERNIQ tightens to 300 (5 min) so upload URLs can't be
// replayed after a browser tab sits open. Operator overrides via
// S3_PRESIGNED_URL_EXPIRY env. Valid range: [60, 604800] per S3 rules
// — under 60s is too aggressive for browser upload latency, over 7d
// is forbidden by AWS.
const DEFAULT_PRESIGNED_URL_EXPIRY_SEC = 300;
const MIN_PRESIGNED_URL_EXPIRY_SEC = 60;
const MAX_PRESIGNED_URL_EXPIRY_SEC = 604800;

@Injectable()
export class StorageService {
  private s3Client: S3Client;
  private bucket: string;
  private region: string;
  private urlExpiry: number;

  constructor() {
    // D19: resolve bucket. The previous default `'spendcheck-receipts'`
    // was a legacy SpendCheck product name — if AWS_S3_BUCKET was
    // unset in production, uploads silently went to the wrong bucket
    // (or 403'd if it doesn't exist). Production boot-guard in
    // env.schema.ts now rejects a missing bucket when NODE_ENV=production.
    // Keep the named default for development/test only.
    this.bucket =
      (process.env.AWS_S3_BUCKET ?? '').trim() || 'cerniq-dev-receipts';

    // D18: honor both AWS_S3_REGION (documented in .env.production
    // template + env.schema.ts) and the undocumented AWS_REGION the
    // service used to read. Prefer the documented name; fall back to
    // AWS_REGION for migration compat. Previously the schema validated
    // AWS_S3_REGION but the code read AWS_REGION, so operator edits
    // of the documented var had zero effect.
    this.region =
      (process.env.AWS_S3_REGION ?? '').trim() ||
      (process.env.AWS_REGION ?? '').trim() ||
      'us-east-1';

    // D20: resolve presigned-URL TTL without parseInt. Bad inputs
    // previously became NaN and reached the AWS SDK with undefined
    // behavior (SDK fell back to its own 900s default silently —
    // doubling the intended replay window).
    this.urlExpiry = StorageService.resolveUrlExpirySec(
      process.env.S3_PRESIGNED_URL_EXPIRY,
    );

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  /**
   * Resolve S3_PRESIGNED_URL_EXPIRY from env. Exported static so the
   * spec can exercise the resolution table without constructing the
   * service (which would require AWS_REGION to be a valid value).
   */
  static resolveUrlExpirySec(raw: string | undefined): number {
    if (raw === undefined || raw === '')
      return DEFAULT_PRESIGNED_URL_EXPIRY_SEC;
    const parsed = Number(raw);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PRESIGNED_URL_EXPIRY_SEC ||
      parsed > MAX_PRESIGNED_URL_EXPIRY_SEC
    ) {
      return DEFAULT_PRESIGNED_URL_EXPIRY_SEC;
    }
    return parsed;
  }

  /**
   * Generate a presigned URL for direct browser upload to S3
   */
  async generateUploadUrl(
    organizationId: string,
    filename: string,
    contentType: string,
  ): Promise<UploadUrlResponse> {
    // Generate unique file key
    const fileExtension = filename.split('.').pop();
    const uniqueFileName = `${uuidv4()}.${fileExtension}`;
    const fileKey = `receipts/${organizationId}/${uniqueFileName}`;

    // Create presigned PUT URL
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      ContentType: contentType,
      Metadata: {
        organizationId,
        originalFilename: filename,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: this.urlExpiry,
    });

    // Public URL (for fetching after upload)
    const fileUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${fileKey}`;

    return {
      uploadUrl,
      fileKey,
      fileUrl,
    };
  }

  /**
   * Generate a presigned URL for downloading/viewing a file
   */
  async generateDownloadUrl(fileKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
    });

    return await getSignedUrl(this.s3Client, command, {
      expiresIn: this.urlExpiry,
    });
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
    });

    await this.s3Client.send(command);
  }

  /**
   * Get public URL for a file (use for already-public files)
   */
  getPublicUrl(fileKey: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${fileKey}`;
  }
}
