import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { AiResultsService } from '../src/ai-results/ai-results.service';
import type { TokenClaims } from '../src/auth/auth.types';
import type { DatabaseService } from '../src/database/database.service';
import type { EventsService } from '../src/events/events.service';
import {
  FaceRecognitionWorker,
  type MatchFaceJob,
} from '../src/face-recognition/face-recognition.worker';
import type { FireAiClient } from '../src/fire/fire-ai.client';
import { FireConfig } from '../src/fire/fire.config';
import type { FireIncidentsRepository } from '../src/fire/fire-incidents.repository';
import { FireProcessorService } from '../src/fire/fire-processor.service';
import { FireTelemetry } from '../src/fire/fire-telemetry.service';
import type { FrigateMediaAdapter } from '../src/media/frigate-media.adapter';
import type { MediaService } from '../src/media/media.service';
import type { WellnessRepository } from '../src/wellness/wellness.repository';
import { WellnessService } from '../src/wellness/wellness.service';
import type { FrigateConfigSyncWorker } from '../src/zones/frigate-config-sync.worker';
import { ZoneScheduleService } from '../src/zones/zone-schedule.service';
import type { ZonesRepository } from '../src/zones/zones.repository';
import { ZonesService } from '../src/zones/zones.service';

describe('Camera-only AI runtime locks while CRUD remains open', () => {
  describe('M1 BullMQ worker stops in-flight recognition when m1_face_enabled is false', () => {
    it('skips AI service call and submission when household disabled M1', async () => {
      const frigateAdapter = {
        getCroppedSnapshot: jest.fn(),
      } as unknown as FrigateMediaAdapter;
      const submit = jest.fn();
      const aiResults = { submit } as unknown as AiResultsService;
      const db = {
        query: jest.fn().mockResolvedValue({ rows: [{ enabled: false }] }),
      } as unknown as DatabaseService;
      const coordinator = { onRecognitionResult: jest.fn() };
      const worker = new FaceRecognitionWorker(
        frigateAdapter,
        new ConfigService({ FACE_JOB_TRANSPORT: 'bullmq' }),
        aiResults,
        coordinator,
        db,
      );

      await worker.process({
        data: {
          eventId: 'evt-1',
          trackId: 'track-1',
          cameraSlug: 'cam_living',
          ownerScopeId: 'owner-1',
          collectionVersion: 1,
          imageBase64: Buffer.from('img').toString('base64'),
        },
      } as Job<MatchFaceJob, void, string>);

      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('m1_face_enabled'), [
        'owner-1',
      ]);
      expect(submit).not.toHaveBeenCalled();
      expect(coordinator.onRecognitionResult).not.toHaveBeenCalled();
    });
  });

  describe('M3 FireProcessorService skips disabled camera and clears cached frame state', () => {
    it('does not call fire AI or confirm incident when findEnabledCamera returns null', async () => {
      const detect = jest.fn();
      const repository = {
        findEnabledCamera: jest.fn().mockResolvedValue(null),
        confirm: jest.fn(),
        clearActive: jest.fn(),
      } as unknown as FireIncidentsRepository;
      const fireCfg = new FireConfig(
        new ConfigService({
          M3_ENABLED: 'true',
          FIRE_FRAME_MAX_AGE_SECONDS: '5',
        }),
      );
      const processor = new FireProcessorService(
        fireCfg,
        { detect } as unknown as FireAiClient,
        repository,
        {} as unknown as MediaService,
        {} as unknown as EventsService,
        new FireTelemetry(fireCfg),
      );

      await processor.process({
        header: {
          schemaVersion: 1,
          cameraSlug: 'cam_fire',
          sourceSessionId: 'sess-fire',
          frameId: '11111111-1111-4111-8111-111111111111',
          frameTimestamp: new Date().toISOString(),
          frameWidth: 640,
          frameHeight: 360,
        },
        image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      });

      expect(repository.findEnabledCamera).toHaveBeenCalledWith('cam_fire');
      expect(detect).not.toHaveBeenCalled();
      expect(repository.confirm).not.toHaveBeenCalled();
    });
  });

  describe('User CRUD remains usable even when camera AI modules are disabled', () => {
    it('allows creating RESTRICTED and REST_AREA zones via ZonesService', async () => {
      const polygon = [
        [0.1, 0.1],
        [0.4, 0.1],
        [0.4, 0.4],
      ];
      const repo = {
        cameraExists: jest.fn().mockResolvedValue(true),
        create: jest.fn().mockImplementation(async (_cameraId, values) => ({
          zone: {
            id: 'zone-1',
            camera_id: 'cam-1',
            name: values.name,
            slug: values.slug,
            zone_type: values.zoneType,
            polygon: values.polygon,
            min_dwell_seconds: values.minDwellSeconds,
            active_from: values.activeFrom,
            active_to: values.activeTo,
            is_enabled: values.isEnabled,
          },
          version: 2,
        })),
      } as unknown as ZonesRepository;
      const syncWorker = { enqueue: jest.fn() } as unknown as FrigateConfigSyncWorker;
      const zones = new ZonesService(repo, new ZoneScheduleService(), syncWorker);

      await expect(
        zones.create('cam-1', {
          name: 'Vùng cấm',
          slug: 'vung_cam',
          zoneType: 'RESTRICTED',
          polygon,
        }),
      ).resolves.toMatchObject({ zoneType: 'RESTRICTED' });
      await expect(
        zones.create('cam-1', {
          name: 'Khu nghỉ',
          slug: 'khu_nghi',
          zoneType: 'REST_AREA',
          polygon,
        }),
      ).resolves.toMatchObject({ zoneType: 'REST_AREA' });
    });

    it('keeps wellness schedule CRUD open while blocking camera AI observations when M5 is off', async () => {
      const caregiver: TokenClaims = {
        sub: 'cg-1',
        email: 'cg@example.test',
        role: 'CAREGIVER',
        tokenType: 'access',
        jti: 'jti-cg',
      };
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      const repo = {
        isWellnessModuleEnabled: jest.fn().mockResolvedValue(false),
        verifyResidentHouseholdLink: jest.fn().mockResolvedValue(true),
        timezoneExists: jest.fn().mockResolvedValue(true),
        enabledCameraIds: jest.fn().mockResolvedValue([]),
        residentCanReceive: jest.fn().mockResolvedValue(true),
        findConflictingSchedule: jest.fn().mockResolvedValue(false),
        createSchedule: jest.fn().mockResolvedValue({
          id: 'sched-1',
          owner_user_id: 'cg-1',
          resident_user_id: 'res-1',
          name: 'Buổi sáng',
          check_at: '09:00',
          days_of_week: [1, 2, 3],
          lookback_hours: 6,
          grace_seconds: 300,
          camera_ids: [],
          timezone: 'Asia/Ho_Chi_Minh',
          is_enabled: true,
          version: 1,
          activation_started_at: new Date(),
          last_materialized_at: null,
          last_checked_at: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        }),
        transaction: jest.fn(async (fn: (c: typeof client) => Promise<unknown>) => fn(client)),
        findObservationById: jest.fn().mockResolvedValue(null),
      } as unknown as WellnessRepository;
      const service = new WellnessService(repo, new ConfigService());

      await expect(
        service.createSchedule(caregiver, { residentUserId: 'res-1', checkAt: '09:00' }),
      ).resolves.toMatchObject({ id: 'sched-1' });

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
