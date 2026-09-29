import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { CreateKnownFaceDto } from './dto/create-known-face.dto';
import { KnownFacesService } from './known-faces.service';
import { KnownFacesGuard } from './known-faces.guard';
import { KnownFacesFilter } from './known-faces.filter';
import type { FaceUpload } from './face-inference.interface';
import { faceError } from './face-error';

function owner(request: AuthenticatedRequest): string {
  if (!request.auth) throw faceError(401, 'UNAUTHORIZED', 'Bạn cần đăng nhập.');
  return request.auth.sub;
}

@Controller('known-faces')
@UseGuards(KnownFacesGuard)
@UseFilters(KnownFacesFilter)
export class KnownFacesController {
  constructor(private readonly service: KnownFacesService) {}
  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.service.list(owner(request));
  }

  @Post()
  @UseInterceptors(FilesInterceptor('images', 5))
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateKnownFaceDto,
    @UploadedFiles() files: FaceUpload[],
  ) {
    return this.service.create(owner(request), dto, files ?? []);
  }

  @Delete(':knownFaceId')
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('knownFaceId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ recognitionStatus: 'SYNC_PENDING' } | void> {
    const ready = await this.service.remove(
      owner(request),
      id,
      request.ip ?? null,
      request.get('user-agent') ?? null,
    );
    response.status(ready ? 204 : 202);
    if (!ready) return { recognitionStatus: 'SYNC_PENDING' };
  }
}
