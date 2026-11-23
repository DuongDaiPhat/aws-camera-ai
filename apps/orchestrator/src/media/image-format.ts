/** Preserve the encoding of best-shot pixels through HTTP and object storage. */
export function imageFormat(bytes: Buffer): { extension: string; contentType: string } {
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return png
    ? { extension: 'png', contentType: 'image/png' }
    : { extension: 'jpg', contentType: 'image/jpeg' };
}
