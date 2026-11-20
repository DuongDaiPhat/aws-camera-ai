import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { PlaybackMetadataService } from './playback-metadata.service';
import type { components } from '@cam/contracts';
import { IsDateString, Matches } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { PlaybackService } from './playback.service';
import type { PlaybackActor, PlaybackCamera, RecordingDay } from './playback.types';
export class RecordingDayQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
}
export class RecordingClipQuery {
  @IsDateString({ strict: true }) startAt!: string;
  @IsDateString({ strict: true }) endAt!: string;
}
@Controller('playback/cameras')
export class PlaybackController {
  constructor(
    private readonly playback: PlaybackService,
    private readonly metadata: PlaybackMetadataService,
  ) {}
  private actor(req: AuthenticatedRequest): PlaybackActor {
    if (!req.auth) throw new UnauthorizedException();
    return req.auth;
  }
  @Get() cameras(@Req() req: AuthenticatedRequest): Promise<{ data: PlaybackCamera[] }> {
    return this.playback.cameras(this.actor(req));
  }
  @Get(':id/recordings')
  @Header('Cache-Control', 'private, no-store')
  day(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RecordingDayQuery,
  ): Promise<RecordingDay> {
    return this.playback.day(this.actor(req), id, query.date);
  }
  @Get(':id/metadata')
  @Header('Cache-Control', 'private, no-store')
  metadataForInterval(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RecordingClipQuery,
  ): Promise<components['schemas']['PlaybackMetadata']> {
    return this.metadata.interval(this.actor(req), id, query.startAt, query.endAt);
  }
  @Get(':id/clip')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async clip(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RecordingClipQuery,
  ): Promise<StreamableFile> {
    return new StreamableFile(
      await this.playback.clip(this.actor(req), id, query.startAt, query.endAt),
      { type: 'video/mp4', disposition: 'inline' },
    );
  }
}
