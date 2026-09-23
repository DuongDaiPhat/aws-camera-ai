import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_STATS_WINDOW_HOURS = 24;
export const MAX_STATS_WINDOW_HOURS = 168;

export class GetEventStatsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_STATS_WINDOW_HOURS)
  windowHours: number = DEFAULT_STATS_WINDOW_HOURS;
}
