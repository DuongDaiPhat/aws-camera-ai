export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export const S3_EXPIRE_7D_TAG = { retention: 'expire-7d' } as const;
export const S3_RETAIN_TAG = { retain: 'true' } as const;

export interface UploadOptions {
  /**
   * When true, marks the object with `retain=true` and excludes `retention=expire-7d`
   * so S3 lifecycle expiration does not delete retained evidence.
   */
  retain?: boolean;
  /**
   * Explicit S3 object tags (`key=value` encoded into PutObjectCommand `Tagging`).
   */
  tags?: Record<string, string>;
}

export interface UploadResult {
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface PresignedUrlResult {
  url: string;
  expiresAt: Date;
}

export interface IStorageService {
  upload(
    key: string,
    body: Buffer,
    contentType: string,
    options?: UploadOptions,
  ): Promise<UploadResult>;
  download(key: string): Promise<Buffer>;
  getPresignedUrl(key: string, expiresInSeconds?: number): Promise<PresignedUrlResult>;
  delete?(key: string): Promise<void>;
}
