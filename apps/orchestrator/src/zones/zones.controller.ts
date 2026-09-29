import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { components } from '@cam/contracts';
import { Roles } from '../auth/roles.decorator';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ZonesService } from './zones.service';

type ZoneDto = components['schemas']['Zone'];

@ApiTags('zones')
@ApiBearerAuth('bearer')
@Controller()
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get('cameras/:cameraId/zones')
  @ApiOperation({ summary: 'Danh sách vùng của camera' })
  async list(@Param('cameraId', ParseUUIDPipe) cameraId: string): Promise<{ data: ZoneDto[] }> {
    return await this.zonesService.list(cameraId);
  }

  @Post('cameras/:cameraId/zones')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Tạo vùng mới và đưa cấu hình Frigate vào hàng đợi' })
  async create(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Body() dto: CreateZoneDto,
  ): Promise<ZoneDto> {
    return await this.zonesService.create(cameraId, dto);
  }

  @Patch('zones/:zoneId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Cập nhật vùng và đưa cấu hình Frigate vào hàng đợi' })
  async update(
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: UpdateZoneDto,
  ): Promise<ZoneDto> {
    return await this.zonesService.update(zoneId, dto);
  }

  @Delete('zones/:zoneId')
  @Roles('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Xóa vùng và đưa cấu hình Frigate vào hàng đợi' })
  async delete(@Param('zoneId', ParseUUIDPipe) zoneId: string): Promise<void> {
    await this.zonesService.delete(zoneId);
  }
}
