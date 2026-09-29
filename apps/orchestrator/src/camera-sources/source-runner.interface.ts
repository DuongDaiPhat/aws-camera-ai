export const SOURCE_RUNNER = Symbol('SOURCE_RUNNER');

export interface SourceRunOptions {
  cameraId: string;
  slug: string;
  videoPath?: string;
  rtspUrl?: string;
  loop?: boolean;
}

export interface SourceRunResult {
  success: boolean;
  pid?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface ISourceRunner {
  start(options: SourceRunOptions): Promise<SourceRunResult>;
  stop(cameraId: string): Promise<boolean>;
  isRunning(cameraId: string): boolean;
  getPid(cameraId: string): number | undefined;
  cleanup(): Promise<void>;
}
