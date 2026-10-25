import { WellnessController } from '../src/wellness/wellness.controller';
import { WellnessService } from '../src/wellness/wellness.service';
import type { AuthenticatedRequest } from '../src/auth/jwt-auth.guard';

describe('WellnessController (US-20)', () => {
  let controller: WellnessController;
  let service: jest.Mocked<WellnessService>;

  const mockRequest: AuthenticatedRequest = {
    auth: {
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
      role: 'CAREGIVER',
      tokenType: 'access',
      jti: 'jti-1',
    },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    service = {
      listSchedules: jest.fn(),
      getScheduleById: jest.fn(),
      createSchedule: jest.fn(),
      updateSchedule: jest.fn(),
      deleteSchedule: jest.fn(),
      listChecks: jest.fn(),
      confirmCheck: jest.fn(),
      submitObservation: jest.fn(),
    } as unknown as jest.Mocked<WellnessService>;

    controller = new WellnessController(service);
  });

  it('listSchedules bọc kết quả trong object { data }', async () => {
    service.listSchedules.mockResolvedValue([]);
    const res = await controller.listSchedules(mockRequest, {});
    expect(res).toEqual({ data: [] });
    expect(service.listSchedules).toHaveBeenCalledWith(mockRequest.auth, undefined);
  });

  it('createSchedule gọi service.createSchedule', async () => {
    const dto = {
      residentUserId: '22222222-2222-4222-8222-222222222222',
      name: 'Kiểm tra 09:00',
      checkAt: '09:00',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    };
    service.createSchedule.mockResolvedValue({
      id: 'sched-1',
      check_at: '09:00:00',
      owner_user_id: 'owner',
    } as any);

    const res = await controller.createSchedule(mockRequest, dto);
    expect(res).toMatchObject({ id: 'sched-1', checkAt: '09:00', configurationStatus: 'READY' });
    expect(res).not.toHaveProperty('check_at');
    expect(service.createSchedule).toHaveBeenCalledWith(mockRequest.auth, dto);
  });

  it('confirmCheck gọi service.confirmCheck', async () => {
    const checkId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const dto = {
      commandId: 'cmd-1',
      response: 'IM_OK' as const,
      note: 'Ổn',
    };
    service.confirmCheck.mockResolvedValue({
      id: 'conf-1',
      eventId: 'evt-1',
      response: 'IM_OK',
      phase: 'INITIAL',
      channel: 'DASHBOARD',
      resultingStatus: 'RESOLVED',
      respondedAt: new Date().toISOString(),
      isAuthoritative: true,
    });

    const res = await controller.confirmCheck(mockRequest, checkId, dto);
    expect(res.response).toBe('IM_OK');
    expect(service.confirmCheck).toHaveBeenCalledWith(mockRequest.auth, checkId, dto);
  });

  it('submitObservation gọi service.submitObservation', async () => {
    const dto = {
      observationId: 'obs-1',
      ownerUserId: 'u-1',
      residentUserId: 'u-2',
      knownFaceId: 'f-1',
      identityEventId: 'e-1',
      cameraId: 'c-1',
      sourceSessionId: 's-1',
      trackId: 't-1',
      kind: 'MOTION' as const,
      observedAt: '2026-10-14T08:00:00Z',
    };
    service.submitObservation.mockResolvedValue({
      observationId: 'obs-1',
      status: 'ACCEPTED',
      presenceUpdated: true,
    });

    const res = await controller.submitObservation(dto);
    expect(res.status).toBe('ACCEPTED');
    expect(service.submitObservation).toHaveBeenCalledWith(dto);
  });
});
