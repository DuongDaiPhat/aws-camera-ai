export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

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
  upload(key: string, body: Buffer, contentType: string): Promise<UploadResult>;
  getPresignedUrl(key: string, expiresInSeconds?: number): Promise<PresignedUrlResult>;
}
