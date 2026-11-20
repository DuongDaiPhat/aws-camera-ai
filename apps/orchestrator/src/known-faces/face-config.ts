import { ConfigService } from '@nestjs/config';

export const DEFAULT_REKOGNITION_COLLECTION_PREFIX = 'camerai-s4-dev-owner-' as const;

export const ALLOWED_REKOGNITION_COLLECTION_PREFIXES = [
  'camerai-s4-dev-owner-',
  'argusai-staging-owner-',
  'argusai-production-owner-',
] as const;

export type RekognitionCollectionPrefix = (typeof ALLOWED_REKOGNITION_COLLECTION_PREFIXES)[number];
export type FaceProvider = 'local' | 'rekognition';

export type FaceConfig =
  | { readonly provider: 'local' }
  | {
      readonly provider: 'rekognition';
      readonly region: string;
      readonly collectionPrefix: RekognitionCollectionPrefix;
    };

export function isAllowedRekognitionCollectionPrefix(
  value: string,
): value is RekognitionCollectionPrefix {
  return (ALLOWED_REKOGNITION_COLLECTION_PREFIXES as readonly string[]).includes(value);
}

export function validateRekognitionCollectionPrefix(
  raw: string | undefined,
  options: { allowDefault?: boolean } = {},
): RekognitionCollectionPrefix {
  if (raw === undefined) {
    if (options.allowDefault) return DEFAULT_REKOGNITION_COLLECTION_PREFIX;
    throw new Error('Missing cloud configuration: REKOGNITION_COLLECTION_PREFIX');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Missing cloud configuration: REKOGNITION_COLLECTION_PREFIX');
  }
  if (!isAllowedRekognitionCollectionPrefix(trimmed)) {
    throw new Error(
      `Invalid REKOGNITION_COLLECTION_PREFIX: must be one of ${ALLOWED_REKOGNITION_COLLECTION_PREFIXES.join(', ')}`,
    );
  }
  return trimmed;
}

export function readFaceProvider(config: ConfigService): FaceProvider {
  const raw = config.get<string>('FACE_PROVIDER');
  if (raw === undefined || raw.trim() === '') return 'local';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'local' || normalized === 'rekognition') {
    return normalized;
  }
  throw new Error('FACE_PROVIDER must be local or rekognition');
}

export function readFaceConfig(config: ConfigService): FaceConfig {
  const provider = readFaceProvider(config);
  if (provider === 'local') {
    return { provider };
  }
  const region = config.get<string>('AWS_REGION')?.trim();
  if (!region) {
    throw new Error('Missing cloud configuration: AWS_REGION');
  }
  const collectionPrefix = validateRekognitionCollectionPrefix(
    config.get<string>('REKOGNITION_COLLECTION_PREFIX'),
    { allowDefault: false },
  );
  return {
    provider,
    region,
    collectionPrefix,
  };
}

export function buildRekognitionCollectionId(
  prefix: RekognitionCollectionPrefix,
  ownerUserId: string,
): string {
  return `${prefix}${ownerUserId}`;
}
