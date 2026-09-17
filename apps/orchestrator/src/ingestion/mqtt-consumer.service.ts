import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EventType, PriorityLevel } from '@cam/contracts';
import { CameraRecord, EventsRepository } from '../events/events.repository';
import {
  FrigateEventAfterDto,
  FrigateEventMessageDto,
} from './dto/frigate-event.dto';

@Injectable()
export class MqttConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttConsumerService.name);
  private client: MqttClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventsRepository: EventsRepository,
  ) {}

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.disconnect();
  }

  /**
   * Kết nối tới MQTT Broker và đăng ký lắng nghe topic.
   */
  connect(): void {
    const mqttUrl = this.configService.get<string>('MQTT_URL', 'mqtt://localhost:1883');
    const clientId = this.configService.get<string>(
      'MQTT_CLIENT_ID',
      `orchestrator-${Math.random().toString(16).substring(2, 8)}`,
    );
    const username = this.configService.get<string>('MQTT_USERNAME');
    const password = this.configService.get<string>('MQTT_PASSWORD');
    const topic = this.configService.get<string>('MQTT_TOPIC_FRIGATE', 'frigate/events');

    this.logger.log(`Dang ket noi MQTT Broker tai ${mqttUrl} (clientId: ${clientId})...`);

    this.client = mqtt.connect(mqttUrl, {
      clientId,
      username: username || undefined,
      password: password || undefined,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
    });

    this.client.on('connect', () => {
      this.logger.log(`Da ket noi MQTT Broker thanh cong. Dang subscribe topic: ${topic}`);
      this.client?.subscribe(topic, (err) => {
        if (err) {
          this.logger.error(`Subscribe topic ${topic} that bai:`, err);
        } else {
          this.logger.log(`Da subscribe topic ${topic}`);
        }
      });
    });

    this.client.on('error', (err) => {
      this.logger.error('Loi ket noi MQTT:', err.message);
    });

    this.client.on('message', async (receivedTopic, buffer) => {
      await this.handleMessage(receivedTopic, buffer);
    });
  }

  disconnect(): void {
    if (this.client) {
      this.logger.log('Ngat ket noi MQTT Client...');
      this.client.end();
      this.client = null;
    }
  }

  /**
   * Parse và validate payload thô nhận được từ MQTT (AC2 - Dead-letter).
   */
  private async parseAndValidate(rawContent: string): Promise<FrigateEventMessageDto | null> {
    try {
      const parsedJson = JSON.parse(rawContent) as unknown;
      const dto = plainToInstance(FrigateEventMessageDto, parsedJson);
      const errors = await validate(dto);

      if (errors.length > 0 || !dto.after) {
        this.logger.warn(
          { rawContent, validationErrors: errors },
          'Dead-letter: Message MQTT thieu truong bat buoc hoac sai schema',
        );
        return null;
      }
      return dto;
    } catch (parseErr) {
      this.logger.warn(
        { rawContent, err: (parseErr as Error).message },
        'Dead-letter: Message MQTT khong phai la JSON hop le',
      );
      return null;
    }
  }

  /**
   * Tra cứu camera và zone tương ứng từ DB.
   */
  private async resolveCameraAndZone(
    cameraSlug: string,
    currentZones?: string[],
  ): Promise<{ camera: CameraRecord | null; zoneId: string | null }> {
    const camera = await this.eventsRepository.findCameraBySlug(cameraSlug);
    if (!camera) {
      this.logger.warn(
        `Camera "${cameraSlug}" chua co trong DB hoac bi disabled. Ghi camera_id=null.`,
      );
      return { camera: null, zoneId: null };
    }

    let zoneId: string | null = null;
    if (currentZones && currentZones.length > 0 && currentZones[0]) {
      const zone = await this.eventsRepository.findZoneByCameraAndSlug(camera.id, currentZones[0]);
      zoneId = zone?.id ?? null;
    }

    return { camera, zoneId };
  }

  /**
   * Xử lý lưu sự kiện vào DB và áp dụng khử trùng lặp (AC1, AC3).
   */
  private async processEvent(after: FrigateEventAfterDto): Promise<void> {
    const inZone = Boolean(after.current_zones && after.current_zones.length > 0);
    const eventType: EventType = inZone ? 'RESTRICTED_ZONE' : 'PERSON_DETECTED';
    const priority: PriorityLevel = inZone ? 'P1' : 'P3';

    // AC3: Tính dedup_key theo track_id trong cửa sổ 10 giây (FR-ING-07)
    const timeBucket = Math.floor(after.frame_time / 10);
    const dedupKey = `${after.camera}:${after.id}:${eventType}:${timeBucket}`;

    const { camera, zoneId } = await this.resolveCameraAndZone(after.camera, after.current_zones);
    const detectedAt = new Date(after.frame_time * 1000);

    const createdEvent = await this.eventsRepository.createEvent({
      cameraId: camera?.id ?? null,
      zoneId,
      eventType,
      status: 'DETECTED',
      priority,
      source: 'FRIGATE',
      trackId: after.id,
      dedupKey,
      confidence: after.score,
      aiResults: [],
      detectedAt,
    });

    if (createdEvent) {
      this.logger.log(
        {
          eventId: createdEvent.id,
          trackId: createdEvent.track_id,
          eventType: createdEvent.event_type,
          camera: after.camera,
          dedupKey,
        },
        'Da ghi nhan su kien moi vao bang events',
      );
    } else {
      this.logger.debug(
        { dedupKey, trackId: after.id },
        'Bo qua su kien trung lap theo dedup_key (Deduplicated)',
      );
    }
  }

  /**
   * Điểm tiếp nhận chính cho message từ topic MQTT (AC1, AC2, AC3).
   */
  async handleMessage(_topic: string, buffer: Buffer): Promise<void> {
    const rawContent = buffer.toString('utf-8');
    const dto = await this.parseAndValidate(rawContent);
    if (!dto || dto.after.label !== 'person') {
      return;
    }

    try {
      await this.processEvent(dto.after);
    } catch (error) {
      this.logger.error(
        { trackId: dto.after.id, err: (error as Error).message },
        'Loi khi xu ly message MQTT tu Frigate',
      );
    }
  }
}
