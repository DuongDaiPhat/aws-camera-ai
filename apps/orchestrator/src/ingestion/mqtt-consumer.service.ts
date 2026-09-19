import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mqtt, { MqttClient } from 'mqtt';

import { EventType, PriorityLevel } from '@cam/contracts';

import { EventRecord, EventsRepository } from '../events/events.repository';
import { MediaService } from '../media/media.service';
import { FrigateEventAfterDto, FrigateEventMessageDto } from './dto/frigate-event.dto';

const DEFAULT_MQTT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_MQTT_RECONNECT_PERIOD_MS = 3_000;

type FrigateMessageType = FrigateEventMessageDto['type'];

interface EventContext {
  cameraId: string | null;
  zoneId: string | null;
  eventType: EventType;
  priority: PriorityLevel;
  dedupKey: string;
  detectedAt: Date;
}

interface SynchronizedEvent {
  event: EventRecord;
  isCreated: boolean;
}

@Injectable()
export class MqttConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttConsumerService.name);
  private client: MqttClient | null = null;
  private processingQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly configService: ConfigService,
    private readonly eventsRepository: EventsRepository,
    private readonly mediaService: MediaService,
  ) {}

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.disconnect();
  }

  connect(): void {
    const mqttUrl = this.configService.get<string>('MQTT_URL', 'mqtt://localhost:1883');
    const clientId = this.configService.get<string>(
      'MQTT_CLIENT_ID',
      `orchestrator-${Math.random().toString(16).substring(2, 8)}`,
    );
    const username = this.configService.get<string>('MQTT_USERNAME');
    const password = this.configService.get<string>('MQTT_PASSWORD');
    const topic = this.configService.get<string>('MQTT_TOPIC_FRIGATE', 'frigate/events');
    const reconnectPeriodMs = Number(
      this.configService.get<string | number>(
        'MQTT_RECONNECT_PERIOD_MS',
        DEFAULT_MQTT_RECONNECT_PERIOD_MS,
      ),
    );
    const connectTimeoutMs = Number(
      this.configService.get<string | number>(
        'MQTT_CONNECT_TIMEOUT_MS',
        DEFAULT_MQTT_CONNECT_TIMEOUT_MS,
      ),
    );

    this.logger.log(`Dang ket noi MQTT Broker tai ${mqttUrl} (clientId: ${clientId})...`);

    this.client = mqtt.connect(mqttUrl, {
      clientId,
      username: username || undefined,
      password: password || undefined,
      reconnectPeriod: reconnectPeriodMs,
      connectTimeout: connectTimeoutMs,
    });

    this.client.on('connect', () => {
      this.logger.log(`Da ket noi MQTT Broker thanh cong. Dang subscribe topic: ${topic}`);
      this.client?.subscribe(topic, (error) => {
        if (error) {
          this.logger.error(`Subscribe topic ${topic} that bai:`, error);
          return;
        }
        this.logger.log(`Da subscribe topic ${topic}`);
      });
    });

    this.client.on('error', (error) => {
      this.logger.error('Loi ket noi MQTT:', error.message);
    });

    this.client.on('message', (receivedTopic, buffer) => {
      this.processingQueue = this.processingQueue
        .then(() => this.handleMessage(receivedTopic, buffer))
        .catch((error: unknown) => {
          this.logger.error(
            'Loi khong mong doi trong hang doi xu ly MQTT',
            error instanceof Error ? error.stack : String(error),
          );
        });
    });
  }

  disconnect(): void {
    if (!this.client) {
      return;
    }

    this.logger.log('Ngat ket noi MQTT Client...');
    this.client.end();
    this.client = null;
  }

  private async parseAndValidate(rawContent: string): Promise<FrigateEventMessageDto | null> {
    try {
      const parsedJson = JSON.parse(rawContent) as unknown;
      const message = plainToInstance(FrigateEventMessageDto, parsedJson);
      const validationErrors = await validate(message);

      if (validationErrors.length > 0 || !message.after) {
        this.logger.warn(
          { rawContent, validationErrors },
          'Dead-letter: Message MQTT thieu truong bat buoc hoac sai schema',
        );
        return null;
      }

      return message;
    } catch (error) {
      this.logger.warn(
        { rawContent, err: error instanceof Error ? error.message : String(error) },
        'Dead-letter: Message MQTT khong phai la JSON hop le',
      );
      return null;
    }
  }

  private getZoneSlugs(after: FrigateEventAfterDto): string[] {
    const currentZones = after.current_zones ?? [];
    return currentZones.length > 0 ? currentZones : (after.entered_zones ?? []);
  }

  private async findZoneId(cameraId: string | null, zoneSlugs: string[]): Promise<string | null> {
    const firstZoneSlug = zoneSlugs[0];
    if (!cameraId || !firstZoneSlug) {
      return null;
    }

    const zone = await this.eventsRepository.findZoneByCameraAndSlug(cameraId, firstZoneSlug);
    return zone?.id ?? null;
  }

  private async buildEventContext(after: FrigateEventAfterDto): Promise<EventContext> {
    const zoneSlugs = this.getZoneSlugs(after);
    const camera = await this.eventsRepository.findCameraBySlug(after.camera);
    const cameraId = camera?.id ?? null;
    const zoneId = await this.findZoneId(cameraId, zoneSlugs);

    if (!camera) {
      this.logger.warn(
        `Camera "${after.camera}" chua co trong DB hoac bi disabled. Ghi camera_id=null.`,
      );
    }

    const isRestrictedZone = zoneSlugs.length > 0;

    return {
      cameraId,
      zoneId,
      eventType: isRestrictedZone ? 'RESTRICTED_ZONE' : 'PERSON_DETECTED',
      priority: isRestrictedZone ? 'P1' : 'P3',
      dedupKey: `frigate:${after.camera}:${after.id}`,
      detectedAt: new Date((after.start_time ?? after.frame_time) * 1_000),
    };
  }

  private async createEvent(
    context: EventContext,
    after: FrigateEventAfterDto,
  ): Promise<EventRecord | null> {
    return await this.eventsRepository.createEvent({
      cameraId: context.cameraId,
      zoneId: context.zoneId,
      eventType: context.eventType,
      status: 'DETECTED',
      priority: context.priority,
      source: 'FRIGATE',
      trackId: after.id,
      dedupKey: context.dedupKey,
      confidence: after.score,
      aiResults: [],
      detectedAt: context.detectedAt,
    });
  }

  private async updateExistingEvent(
    event: EventRecord,
    context: EventContext,
    after: FrigateEventAfterDto,
  ): Promise<EventRecord> {
    const isRestrictedZone =
      event.event_type === 'RESTRICTED_ZONE' || context.eventType === 'RESTRICTED_ZONE';
    const updatedEvent = await this.eventsRepository.updateEvent({
      eventId: event.id,
      cameraId: context.cameraId,
      zoneId: context.zoneId,
      eventType: isRestrictedZone ? 'RESTRICTED_ZONE' : 'PERSON_DETECTED',
      priority: isRestrictedZone ? 'P1' : 'P3',
      confidence: after.score,
    });

    if (!updatedEvent) {
      throw new Error(`Khong the cap nhat event ${event.id} cho track ${after.id}`);
    }
    return updatedEvent;
  }

  private async synchronizeEvent(
    messageType: FrigateMessageType,
    after: FrigateEventAfterDto,
  ): Promise<SynchronizedEvent> {
    const context = await this.buildEventContext(after);
    let event =
      messageType === 'new'
        ? null
        : await this.eventsRepository.findEventByDedupKey(context.dedupKey);
    let isCreated = false;

    if (!event) {
      event = await this.createEvent(context, after);
      isCreated = event !== null;
    }

    if (!event) {
      event = await this.eventsRepository.findEventByDedupKey(context.dedupKey);
    }

    if (!event) {
      throw new Error(`Khong the tao hoac tim event cho track ${after.id}`);
    }

    if (!isCreated) {
      event = await this.updateExistingEvent(event, context, after);
    }

    this.logger.log(
      {
        correlationId: event.correlation_id,
        eventId: event.id,
        trackId: after.id,
        messageType,
        eventType: event.event_type,
        camera: after.camera,
        dedupKey: context.dedupKey,
      },
      isCreated
        ? 'Da ghi nhan su kien moi vao bang events'
        : 'Da cap nhat su kien theo vong doi Frigate track',
    );

    return { event, isCreated };
  }

  private async synchronizeMedia(
    messageType: FrigateMessageType,
    event: EventRecord,
    after: FrigateEventAfterDto,
  ): Promise<void> {
    if (after.has_snapshot) {
      await this.mediaService.downloadAndStoreSnapshot(event.id, after.id, event.detected_at);
    }

    if (
      messageType === 'end' &&
      after.has_clip &&
      (event.priority === 'P0' || event.priority === 'P1')
    ) {
      const startAt = new Date((after.start_time ?? after.frame_time) * 1_000);
      const endAt = after.end_time ? new Date(after.end_time * 1_000) : new Date();
      const measuredDurationMs = Math.round(endAt.getTime() - startAt.getTime());
      const durationMs = measuredDurationMs > 0 ? measuredDurationMs : undefined;

      await this.mediaService.downloadAndStoreClip(
        event.id,
        after.id,
        event.detected_at,
        durationMs,
      );
    }
  }

  async handleMessage(_topic: string, buffer: Buffer): Promise<void> {
    const message = await this.parseAndValidate(buffer.toString('utf8'));
    if (!message || message.after.label !== 'person') {
      return;
    }

    try {
      const { event } = await this.synchronizeEvent(message.type, message.after);
      await this.synchronizeMedia(message.type, event, message.after);
    } catch (error) {
      this.logger.error(
        { trackId: message.after.id, err: error instanceof Error ? error.message : String(error) },
        'Loi khi xu ly message MQTT tu Frigate',
      );
    }
  }
}
