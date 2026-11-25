import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenClaims } from '../src/auth/auth.types';
import type { FaceCollectionSyncService } from '../src/known-faces/face-collection-sync.service';
import type { IFaceInference } from '../src/known-faces/face-inference.interface';
import type { KnownFacesRepository } from '../src/known-faces/known-faces.repository';
import { KnownFacesService } from '../src/known-faces/known-faces.service';
import type { WellnessRepository } from '../src/wellness/wellness.repository';
import { WellnessService } from '../src/wellness/wellness.service';
import type { FrigateConfigSyncWorker } from '../src/zones/frigate-config-sync.worker';
import { ZoneScheduleService } from '../src/zones/zone-schedule.service';
import type { ZonesRepository } from '../src/zones/zones.repository';
import { ZonesService } from '../src/zones/zones.service';

describe('AI module API feature locks when Caregiver turns modules OFF', () => {
  describe('M1 KnownFacesService lock', () => {
    it('rejects create, update, and remove when m1_face_enabled is false, and allows when true', async () => {
      const repo = {
        householdOwner: jest.fn().mockResolvedValue('owner-1'),
        isFaceModuleEnabled: jest.fn().mockResolvedValue(false),
        update: jest.fn(),
        remove: jest.fn(),
        list: jest.fn().mockResolvedValue([{ id: 'face-1', personName: 'An' }]),
      } as unknown as KnownFacesRepository;
      const inference = {
        embed: jest.fn(),
        sync: jest.fn(),
      } as unknown as IFaceInference;
      const sync = {
        sync: jest.fn().mockResolvedValue(true),
      } as unknown as FaceCollectionSyncService;
      const config = new ConfigService({ FACE_PROVIDER: 'local' });
      const service = new KnownFacesService(repo, inference, sync, config);

      await expect(service.create('cg-1', { personName: 'An' }, [])).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.update('cg-1', 'face-1', { personName: 'An 2' })).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.remove('cg-1', 'face-1', null, null)).rejects.toMatchObject({
        status: 403,
      });

      (repo.isFaceModuleEnabled as jest.Mock).mockResolvedValue(true);
      await expect(service.update('cg-1', 'face-1', { personName: 'An 2' })).resolves.toMatchObject(
        { id: 'face-1' },
      );
      await expect(service.remove('cg-1', 'face-1', null, null)).resolves.toBe(true);
    });
  });

  describe('M2a & M4 ZonesService lock', () => {
    const polygon = [
      [0.1, 0.1],
      [0.4, 0.1],
      [0.4, 0.4],
    ];

    it('rejects RESTRICTED when M4 is off and REST_AREA when M2a is off, while NORMAL stays usable', async () => {
      const repo = {
        cameraExists: jest.fn().mockResolvedValue(true),
        getCameraAiModules: jest.fn().mockResolvedValue({ m2aFall: false, m4Zone: false }),
        findById: jest.fn().mockResolvedValue({
          id: 'zone-1',
          camera_id: 'cam-1',
          name: 'Restricted',
          slug: 'restricted_1',
          zone_type: 'RESTRICTED',
          polygon,
          min_dwell_seconds: 2,
          active_from: null,
          active_to: null,
          is_enabled: true,
        }),
        create: jest.fn().mockResolvedValue({
          zone: {
            id: 'zone-2',
            camera_id: 'cam-1',
            name: 'Normal',
            slug: 'normal_1',
            zone_type: 'NORMAL',
            polygon,
            min_dwell_seconds: 2,
            active_from: null,
            active_to: null,
            is_enabled: true,
          },
          version: 2,
        }),
        update: jest.fn(),
      } as unknown as ZonesRepository;
      const syncWorker = { enqueue: jest.fn() } as unknown as FrigateConfigSyncWorker;
      const service = new ZonesService(repo, new ZoneScheduleService(), syncWorker);

      await expect(
        service.create('cam-1', {
          name: 'Bep',
          slug: 'bep',
          zoneType: 'RESTRICTED',
          polygon,
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.create('cam-1', {
          name: 'Giuong',
          slug: 'giuong',
          zoneType: 'REST_AREA',
          polygon,
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(service.update('zone-1', { name: 'Updated' })).rejects.toThrow(
        ForbiddenException,
      );

      await expect(
        service.create('cam-1', {
          name: 'Normal',
          slug: 'normal_1',
          zoneType: 'NORMAL',
          polygon,
        }),
      ).resolves.toMatchObject({ zoneType: 'NORMAL' });
    });
  });

  describe('M5 WellnessService lock', () => {
    const caregiver: TokenClaims = {
      sub: 'cg-1',
      email: 'cg@example.test',
      role: 'CAREGIVER',
      tokenType: 'access',
      jti: 'jti-cg',
    };

    it('rejects createSchedule, updateSchedule, and submitObservation when m5_wellness_enabled is false', async () => {
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      const repo = {
        isWellnessModuleEnabled: jest.fn().mockResolvedValue(false),
        transaction: jest.fn(async (fn: (c: typeof client) => Promise<unknown>) => fn(client)),
        getScheduleById: jest.fn().mockResolvedValue({
          id: 'sched-1',
          owner_user_id: 'cg-1',
          resident_user_id: 'res-1',
          check_at: '09:00',
          camera_ids: [],
          timezone: 'Asia/Ho_Chi_Minh',
          is_enabled: true,
        }),
        findObservationById: jest.fn().mockResolvedValue(null),
      } as unknown as WellnessRepository;
      const service = new WellnessService(repo, new ConfigService());

      await expect(
        service.createSchedule(caregiver, {
          residentUserId: 'res-1',
          checkAt: '09:00',
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.updateSchedule(caregiver, 'sched-1', { name: 'New name' }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.submitObservation({
          observationId: 'obs-1',
          ownerUserId: 'cg-1',
          residentUserId: 'res-1',
          knownFaceId: 'face-1',
          identityEventId: 'evt-1',
          cameraId: 'cam-1',
          sourceSessionId: 'sess-1',
          trackId: 'track-1',
          kind: 'MOTION',
          observedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
