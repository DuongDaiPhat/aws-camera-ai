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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import type { UserRole } from '../auth/auth.types';
import { CamerasService } from './cameras.service';
import { ListCamerasQueryDto } from './dto/list-cameras-query.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { UpdateCameraStateDto } from './dto/update-camera-state.dto';
import { UpdateCameraSourceDto } from './dto/update-camera-source.dto';
import type { CameraDto, CameraSourceDetail } from './cameras.types';
import type { CameraPreviewV1 } from '../contracts/vertical-slice.ports';

@ApiTags('cameras')
@ApiBearerAuth('bearer')
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách camera',
    description: 'Lấy danh sách camera kèm thông tin nguồn phát và trạng thái đồng bộ Frigate.',
  })
  @ApiResponse({ status: 200, description: 'Danh sách camera' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async listCameras(
    @Query() query: ListCamerasQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ data: CameraDto[] }> {
    const role = this.extractRole(request);
    return await this.camerasService.listCameras(query, role);
  }

  @Get(':cameraId')
  @ApiOperation({ summary: 'Chi tiết camera' })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Thông tin chi tiết camera' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async getCamera(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CameraDto> {
    const role = this.extractRole(request);
    return await this.camerasService.getCamera(cameraId, role);
  }

  @Patch(':cameraId')
  @ApiOperation({ summary: 'Cập nhật thông tin camera (chỉ ADMIN)' })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không có quyền (yêu cầu ADMIN)' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async updateCamera(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Body() dto: UpdateCameraDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CameraDto> {
    const role = this.extractRole(request);
    return await this.camerasService.updateCamera(cameraId, dto, role);
  }

  @Delete(':cameraId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Xóa camera (chỉ ADMIN)' })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Đã xóa camera thành công' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không có quyền (yêu cầu ADMIN)' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async deleteCamera(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const role = this.extractRole(request);
    await this.camerasService.deleteCamera(cameraId, role);
  }

  @Get(':cameraId/snapshot')
  @ApiOperation({
    summary: 'Ảnh preview hiện tại của camera (US-12)',
    description: 'Dùng làm nền để admin vẽ vùng giám sát (Zones).',
  })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Presigned URL ảnh snapshot preview' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async getCameraSnapshot(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
  ): Promise<CameraPreviewV1> {
    return await this.camerasService.getPreview(cameraId);
  }

  @Put(':cameraId/state')
  @ApiOperation({
    summary: 'Bật hoặc tắt camera (desired state, chỉ ADMIN)',
    description: 'Chuyển đổi trạng thái isEnabled và đồng bộ runtime status.',
  })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Trạng thái camera sau khi cập nhật' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không có quyền (yêu cầu ADMIN)' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async updateCameraState(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Body() dto: UpdateCameraStateDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CameraDto> {
    const role = this.extractRole(request);
    return await this.camerasService.updateCameraState(cameraId, dto.isEnabled, role);
  }

  @Get(':cameraId/source')
  @ApiOperation({ summary: 'Chi tiết nguồn phát của camera' })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Chi tiết nguồn phát' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async getCameraSource(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CameraSourceDetail> {
    const role = this.extractRole(request);
    return await this.camerasService.getCameraSource(cameraId, role);
  }

  @Put(':cameraId/source')
  @ApiOperation({ summary: 'Cập nhật cấu hình nguồn phát camera (chỉ ADMIN)' })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Nguồn phát sau khi cập nhật' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không có quyền (yêu cầu ADMIN)' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async updateCameraSource(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Body() dto: UpdateCameraSourceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CameraSourceDetail> {
    const role = this.extractRole(request);
    return await this.camerasService.updateCameraSource(cameraId, dto, role);
  }

  @Post(':cameraId/source/browser-session')
  @ApiOperation({
    summary: 'Cấp phiên publish WebRTC/WHIP cho webcam trình duyệt (chỉ ADMIN)',
  })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Thông tin publish WebRTC/WHIP' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không có quyền (yêu cầu ADMIN)' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async createBrowserPublishSession(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ publishUrl: string; streamKey: string; expiresAt: string }> {
    const role = this.extractRole(request);
    return await this.camerasService.createBrowserPublishSession(cameraId, role);
  }

  @Post(':cameraId/frigate-sync/retry')
  @ApiOperation({
    summary: 'Thử lại đồng bộ cấu hình xuống Frigate (chỉ ADMIN)',
  })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Kết quả thử lại đồng bộ' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 403, description: 'Không có quyền (yêu cầu ADMIN)' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async retryFrigateSync(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ cameraId: string; configVersion: number; syncStatus: 'PENDING' | 'SYNCED' | 'FAILED' }> {
    const role = this.extractRole(request);
    return await this.camerasService.retryFrigateSync(cameraId, role);
  }

  @Get(':cameraId/zones')
  @ApiOperation({
    summary: 'Danh sách các vùng giám sát (Zones) của camera (US-12)',
    description: 'Trả về danh sách polygon zones để vẽ overlay trên Debug View.',
  })
  @ApiParam({ name: 'cameraId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Danh sách các vùng giám sát' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy camera' })
  async getCameraZones(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
  ): Promise<{
    data: Array<{
      id: string;
      cameraId: string;
      name: string;
      slug: string;
      zoneType: string;
      polygon: number[][];
      isEnabled: boolean;
    }>;
  }> {
    const data = await this.camerasService.getCameraZones(cameraId);
    return { data };
  }

  private extractRole(request: AuthenticatedRequest): UserRole {
    return request.auth?.role ?? 'VIEWER';
  }
}
