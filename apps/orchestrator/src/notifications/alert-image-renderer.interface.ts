export const ALERT_IMAGE_RENDERER = Symbol('ALERT_IMAGE_RENDERER');

export interface IAlertImageRenderer {
  /** Return an annotated delivery copy, or null when there is no verified box evidence. */
  render(image: Buffer, metadata: unknown): Promise<Buffer | null>;
}
