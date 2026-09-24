import { Module } from '@nestjs/common';
import { SOURCE_RUNNER } from './source-runner.interface';
import { MediaMtxService } from './media-mtx.service';
import { FfmpegSourceRunnerService } from './ffmpeg-source-runner.service';
import { CameraSourcesRepository } from './camera-sources.repository';
import { CameraSourcesService } from './camera-sources.service';

@Module({
  providers: [
    MediaMtxService,
    CameraSourcesRepository,
    FfmpegSourceRunnerService,
    {
      provide: SOURCE_RUNNER,
      useExisting: FfmpegSourceRunnerService,
    },
    CameraSourcesService,
  ],
  exports: [CameraSourcesService, SOURCE_RUNNER, MediaMtxService],
})
export class CameraSourcesModule {}
