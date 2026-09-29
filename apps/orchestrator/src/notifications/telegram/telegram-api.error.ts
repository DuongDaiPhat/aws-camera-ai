export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }

  get permanent(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}
