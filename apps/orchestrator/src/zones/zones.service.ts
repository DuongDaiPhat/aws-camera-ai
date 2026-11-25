import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { components } from '@cam/contracts';
import type { CreateZoneDto } from './dto/create-zone.dto';
import type { UpdateZoneDto } from './dto/update-zone.dto';
import { FrigateConfigSyncWorker } from './frigate-config-sync.worker';
import { ZoneScheduleService } from './zone-schedule.service';
import { ZonesRepository, type ZoneRecord } from './zones.repository';

type ZoneDto = components['schemas']['Zone'];

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

@Injectable()
export class ZonesService {
  constructor(
    private readonly zonesRepository: ZonesRepository,
    private readonly scheduleService: ZoneScheduleService,
    private readonly syncWorker: FrigateConfigSyncWorker,
  ) {}

  async list(cameraId: string): Promise<{ data: ZoneDto[] }> {
    if (!(await this.zonesRepository.cameraExists(cameraId))) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }
    const zones = await this.zonesRepository.listByCameraId(cameraId);
    return { data: zones.map((zone) => this.toDto(zone)) };
  }

  async create(cameraId: string, dto: CreateZoneDto): Promise<ZoneDto> {
    if (!(await this.zonesRepository.cameraExists(cameraId))) {
      throw new NotFoundException({
        error: { code: 'CAMERA_NOT_FOUND', message: `Không tìm thấy camera với ID: ${cameraId}` },
      });
    }
    const schedule = {
      activeFrom: dto.activeFrom ?? null,
      activeTo: dto.activeTo ?? null,
    };
    this.scheduleService.validate(schedule);

    try {
      const result = await this.zonesRepository.create(cameraId, {
        name: dto.name,
        slug: dto.slug,
        zoneType: dto.zoneType,
        polygon: dto.polygon,
        minDwellSeconds: dto.minDwellSeconds ?? 2,
        activeFrom: schedule.activeFrom,
        activeTo: schedule.activeTo,
        isEnabled: dto.isEnabled ?? true,
      });
      this.syncWorker.enqueue(cameraId);
      return this.toDto(result.zone);
    } catch (error) {
      this.rethrowConflict(error);
      throw error;
    }
  }

  async update(zoneId: string, dto: UpdateZoneDto): Promise<ZoneDto> {
    const existing = await this.zonesRepository.findById(zoneId);
    if (!existing) this.throwZoneNotFound(zoneId);

    const activeFrom = dto.activeFrom !== undefined ? dto.activeFrom : existing.active_from;
    const activeTo = dto.activeTo !== undefined ? dto.activeTo : existing.active_to;
    this.scheduleService.validate({ activeFrom, activeTo });

    try {
      const result = await this.zonesRepository.update(zoneId, {
        name: dto.name ?? existing.name,
        zoneType: dto.zoneType ?? existing.zone_type,
        polygon: dto.polygon ?? existing.polygon,
        minDwellSeconds: dto.minDwellSeconds ?? existing.min_dwell_seconds,
        activeFrom,
        activeTo,
        isEnabled: dto.isEnabled ?? existing.is_enabled,
      });
      if (!result) this.throwZoneNotFound(zoneId);
      this.syncWorker.enqueue(result.zone.camera_id);
      return this.toDto(result.zone);
    } catch (error) {
      this.rethrowConflict(error);
      throw error;
    }
  }

  async delete(zoneId: string): Promise<void> {
    const result = await this.zonesRepository.delete(zoneId);
    if (!result) this.throwZoneNotFound(zoneId);
    this.syncWorker.enqueue(result.cameraId);
  }

  private toDto(record: ZoneRecord): ZoneDto {
    return {
      id: record.id,
      cameraId: record.camera_id,
      name: record.name,
      slug: record.slug,
      zoneType: record.zone_type,
      polygon: record.polygon,
      minDwellSeconds: record.min_dwell_seconds,
      activeFrom: record.active_from ? record.active_from.slice(0, 5) : null,
      activeTo: record.active_to ? record.active_to.slice(0, 5) : null,
      isEnabled: record.is_enabled,
    };
  }

  private rethrowConflict(error: unknown): void {
    if (!isUniqueViolation(error)) return;
    throw new ConflictException({
      error: {
        code: 'ZONE_ALREADY_EXISTS',
        message: 'Tên hoặc slug vùng đã tồn tại trong camera này.',
      },
    });
  }

  private throwZoneNotFound(zoneId: string): never {
    throw new NotFoundException({
      error: { code: 'ZONE_NOT_FOUND', message: `Không tìm thấy vùng với ID: ${zoneId}` },
    });
  }
}
