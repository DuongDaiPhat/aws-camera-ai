import { MediaType } from '@cam/contracts';

export class EventMediaResponseDto {
  id!: string;
  mediaType!: MediaType;
  url!: string;
  expiresAt!: string;
  contentType!: string;
  sizeBytes!: number | null;
  width!: number | null;
  height!: number | null;
  durationMs!: number | null;
  createdAt!: string;
}

export class ListEventMediaResponseDto {
  data!: EventMediaResponseDto[];
}
