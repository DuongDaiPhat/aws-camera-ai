import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { EventsController } from '../src/events/events.controller';
import { EventsService } from '../src/events/events.service';

describe('EventsController (US-06)', () => {
  let controller: EventsController;
  let service: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const mockEventsService = {
      listEvents: jest.fn(),
      streamEvents: jest.fn(),
      getEvent: jest.fn(),
      getStats: jest.fn(),
      confirmEvent: jest.fn(),
      closeEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventsService, useValue: mockEventsService }],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    service = module.get(EventsService);
  });

  it('listEvents goi service va tra ve ket qua', async () => {
    const mockResponse = {
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    };
    service.listEvents.mockResolvedValueOnce(mockResponse);

    const query = { page: 1, pageSize: 20 };
    const result = await controller.listEvents(query);

    expect(service.listEvents).toHaveBeenCalledWith(query);
    expect(result).toBe(mockResponse);
  });

  it('streamEvents goi service streamEvents va tra ve observable', (done) => {
    const mockObservable = of({ type: 'event.created', data: '{}' });
    service.streamEvents.mockReturnValueOnce(mockObservable);

    const result$ = controller.streamEvents('token-xyz');
    expect(service.streamEvents).toHaveBeenCalledWith('token-xyz');

    result$.subscribe((val) => {
      expect(val.type).toBe('event.created');
      done();
    });
  });

  it('confirmEvent goi service confirmEvent voi userId va dto', async () => {
    const mockResult = {
      id: 'conf-1',
      eventId: 'evt-1',
      phase: 'INITIAL' as const,
      response: 'IM_OK' as const,
      channel: 'DASHBOARD' as const,
      confirmedByName: 'Admin',
      note: 'Ổn',
      respondedAt: new Date().toISOString(),
      resultingStatus: 'RESOLVED' as const,
    };
    service.confirmEvent.mockResolvedValueOnce(mockResult);

    const mockReq = { auth: { sub: 'user-1' } } as any;
    const dto = { response: 'IM_OK' as const, note: 'Ổn' };

    const result = await controller.confirmEvent('evt-1', dto, mockReq);
    expect(service.confirmEvent).toHaveBeenCalledWith('evt-1', 'user-1', dto);
    expect(result).toBe(mockResult);
  });

  it('closeEvent goi service closeEvent voi userId va dto', async () => {
    const mockResult = {
      id: 'conf-2',
      eventId: 'evt-1',
      phase: 'EMERGENCY' as const,
      response: 'ACKNOWLEDGED' as const,
      channel: 'DASHBOARD' as const,
      confirmedByName: 'Admin',
      note: 'Xong',
      respondedAt: new Date().toISOString(),
      resultingStatus: 'CLOSED' as const,
    };
    service.closeEvent.mockResolvedValueOnce(mockResult);

    const mockReq = { auth: { sub: 'user-1' } } as any;
    const dto = { note: 'Xong' };

    const result = await controller.closeEvent('evt-1', dto, mockReq);
    expect(service.closeEvent).toHaveBeenCalledWith('evt-1', 'user-1', dto);
    expect(result).toBe(mockResult);
  });
});
