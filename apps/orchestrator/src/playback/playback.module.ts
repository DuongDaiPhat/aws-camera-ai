import { PlaybackFramesRepository } from './playback-frames.repository';
import { PlaybackFramesService } from './playback-frames.service';
import { PlaybackMetadataService } from './playback-metadata.service';
import { Module } from '@nestjs/common';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';
import { PlaybackRepository } from './playback.repository';
import { FrigateRecordingAdapter } from './frigate-recording.adapter';
import { RECORDING_ARCHIVE } from './playback.types';
@Module({
  controllers: [PlaybackController],
  exports: [PlaybackFramesService],
  providers: [
    PlaybackFramesRepository,
    PlaybackFramesService,
    PlaybackMetadataService,
    PlaybackService,
    PlaybackRepository,
    { provide: RECORDING_ARCHIVE, useClass: FrigateRecordingAdapter },
  ],
})
export class PlaybackModule {}
