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
});
