import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WellnessRepository } from './wellness.repository';
import type { WellnessScheduleRecord } from './wellness.types';

@Injectable()
export class WellnessSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WellnessSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly catchUpSeconds: number;

  constructor(
    private readonly repository: WellnessRepository,
    private readonly configService: ConfigService,
  ) {
    this.pollIntervalMs = Number(
      this.configService.get<number>('WELLNESS_POLL_INTERVAL_MS') ?? 5000,
    );
    this.batchSize = Number(this.configService.get<number>('WELLNESS_BATCH_SIZE') ?? 50);
    this.leaseSeconds = Number(this.configService.get<number>('WELLNESS_RUN_LEASE_SECONDS') ?? 30);
    this.catchUpSeconds = Number(this.configService.get<number>('WELLNESS_CATCHUP_SECONDS') ?? 300);
  }

  onModuleInit(): void {
    this.logger.log(
      `Khởi động WellnessScheduler (chu kỳ ${this.pollIntervalMs}ms, batch ${this.batchSize})`,
    );
    void this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('Đã dừng WellnessScheduler');
  }

  /**
   * Một chu kỳ quét và đánh giá scheduler
   */
  async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Phục hồi các lease quá hạn
      await this.repository.reclaimExpiredLeases();

      // 2. Sinh các lượt chạy đến hạn (materialize occurrences)
      await this.materializeDueOccurrences();

      // 3. Đánh giá các lượt chạy đang PENDING
      await this.evaluatePendingRuns();

      // 4. Quét các lượt kiểm tra quá hạn phản hồi (5 phút) hoặc quá hạn gửi
      await this.processTimeouts();
    } catch (err) {
      this.logger.error('Lỗi trong chu kỳ WellnessScheduler', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Sinh bản ghi wellness_check_runs cho các lịch đã đến giờ kiểm tra trong ngày
   */
  async materializeDueOccurrences(): Promise<void> {
    const schedules = await this.repository.getActiveEnabledSchedules();
    const now = new Date();

    for (const schedule of schedules) {
      const occurrence = this.computeScheduleOccurrence(schedule, now);
      if (!occurrence) continue;

      // Chỉ materialize khi đã đến hoặc qua thời điểm scheduled_for
      if (now >= occurrence.scheduledFor) {
        await this.repository.insertCheckRunIfNotExists({
          scheduleId: schedule.id,
          ownerUserId: schedule.owner_user_id!,
          residentUserId: schedule.resident_user_id,
          localDate: occurrence.localDate,
          scheduledFor: occurrence.scheduledFor,
          scheduleVersion: schedule.version,
          scheduleSnapshot: {
            name: schedule.name,
            checkAt: schedule.check_at,
            daysOfWeek: schedule.days_of_week,
            lookbackHours: schedule.lookback_hours,
            graceSeconds: schedule.grace_seconds,
            cameraIds: schedule.camera_ids,
            timezone: schedule.timezone,
          },
          lookbackStartedAt: occurrence.lookbackStartedAt,
          lookbackEndedAt: occurrence.lookbackEndedAt,
          graceSeconds: schedule.grace_seconds,
          availableAt: occurrence.scheduledFor,
        });

        await this.repository.updateScheduleLastCheckedAt(schedule.id, now);
      }
    }
  }

  /**
   * Đánh giá các lượt chạy (runs) đang ở trạng thái PENDING
   */
  async evaluatePendingRuns(): Promise<void> {
    const client = await this.repository.getPoolClient();
    try {
      await client.query('BEGIN');
      const runs = await this.repository.claimPendingRuns(
        this.batchSize,
        this.leaseSeconds,
        client,
      );
      await client.query('COMMIT');

      for (const run of runs) {
        await this.evaluateSingleRun(run);
      }
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      this.logger.error('Lỗi khi claim pending wellness runs', err);
    } finally {
      client.release();
    }
  }

  /**
   * Thực thi logic quyết định cho từng run
   */
  async evaluateSingleRun(run: {
    id: string;
    schedule_id: string;
    owner_user_id: string;
    resident_user_id: string;
    scheduled_for: Date;
    lookback_started_at: Date;
    lookback_ended_at: Date;
    grace_seconds: number;
    lease_token: string | null;
    schedule_snapshot: Record<string, unknown>;
  }): Promise<void> {
    if (!run.lease_token) return;

    const client = await this.repository.getPoolClient();
    try {
      await client.query('BEGIN');

      const now = new Date();

      // 1. Kiểm tra lịch còn tồn tại và đang bật không
      const schedule = await this.repository.getScheduleById(run.schedule_id, client);
      if (!schedule || !schedule.is_enabled || schedule.deleted_at !== null) {
        await this.repository.updateRunDecision(
          run.id,
          run.lease_token,
          'SKIPPED_DISABLED',
          { decisionReason: 'Schedule đã bị tắt hoặc xóa trước khi đánh giá' },
          client,
        );
        await client.query('COMMIT');
        return;
      }

      // 2. Kiểm tra nếu quá hạn catch-up (downtime quá lâu)
      const latenessSeconds = (now.getTime() - new Date(run.scheduled_for).getTime()) / 1000;
      if (latenessSeconds > this.catchUpSeconds) {
        await this.repository.updateRunDecision(
          run.id,
          run.lease_token,
          'MISSED',
          {
            decisionReason: `Quá hạn catch-up (${Math.round(latenessSeconds)}s > ${this.catchUpSeconds}s)`,
          },
          client,
        );
        await client.query('COMMIT');
        return;
      }

      // 3. Kiểm tra nếu người đó đã rời nhà (Module 1 ghi nhận DEPARTURE còn hạn)
      const presenceState = await this.repository.getPresenceState(
        run.owner_user_id,
        run.resident_user_id,
        run.scheduled_for,
        client,
      );

      if (presenceState === 'AWAY') {
        this.logger.log(
          `Bỏ qua kiểm tra wellness (${run.id}) cho resident=${run.resident_user_id}: Người nhà đã rời khỏi nhà (AWAY).`,
        );
        await this.repository.updateRunDecision(
          run.id,
          run.lease_token,
          'SKIPPED_AWAY',
          {
            decisionReason: 'Module 1 ghi nhận người đó đã rời khỏi nhà (AWAY)',
            presenceState: 'AWAY',
          },
          client,
        );
        await client.query('COMMIT');
        return;
      }

      // 4. Kiểm tra hoạt động (motion/arrival) trong cửa sổ lookback
      const cameraIds = Array.isArray(schedule.camera_ids) ? schedule.camera_ids : [];
      const lastActivityAt = await this.repository.findActivityInWindow(
        run.owner_user_id,
        run.resident_user_id,
        cameraIds,
        new Date(run.lookback_started_at),
        new Date(run.lookback_ended_at),
        client,
      );

      if (lastActivityAt) {
        this.logger.log(
          `Bỏ qua kiểm tra wellness (${run.id}): Đã phát hiện hoạt động lúc ${lastActivityAt.toISOString()}`,
        );
        await this.repository.updateRunDecision(
          run.id,
          run.lease_token,
          'SKIPPED_ACTIVITY',
          {
            decisionReason: 'Đã phát hiện chuyển động của người đã đăng ký trong cửa sổ',
            lastActivityAt,
            presenceState: 'HOME',
          },
          client,
        );
        await client.query('COMMIT');
        return;
      }

      // 5. Kiểm tra nếu đã có sự kiện wellness chưa xử lý
      const existingActiveEventId = await this.repository.hasActiveUnresolvedWellnessEvent(
        run.owner_user_id,
        run.resident_user_id,
        client,
      );

      if (existingActiveEventId) {
        await this.repository.updateRunDecision(
          run.id,
          run.lease_token,
          'SKIPPED_SUPERSEDED',
          { decisionReason: `Đang có sự kiện wellness chưa xử lý (${existingActiveEventId})` },
          client,
        );
        await client.query('COMMIT');
        return;
      }

      // 6. KHÔNG có hoạt động -> Tạo sự kiện WELLNESS_TIMEOUT priority P2
      this.logger.warn(
        `Phát hiện không có hoạt động cho resident=${run.resident_user_id} trong ${schedule.lookback_hours}h qua. Tạo sự kiện WELLNESS_TIMEOUT (P2).`,
      );

      const eventRes = await client.query(
        `INSERT INTO events (
          event_type, status, priority, source, detected_at, notified_at,
          wellness_owner_user_id, wellness_resident_user_id, zone_name
        ) VALUES (
          'WELLNESS_TIMEOUT', 'NOTIFIED', 'P2', 'SCHEDULER', now(), now(),
          $1, $2, 'Kiểm tra sức khỏe định kỳ'
        ) RETURNING id`,
        [run.owner_user_id, run.resident_user_id],
      );
      const eventId = eventRes.rows[0].id;

      await client.query(
        `INSERT INTO event_status_history (
          event_id, from_status, to_status, reason, actor_type, metadata
        ) VALUES (
          $1, 'DETECTED', 'NOTIFIED', 'NO_ACTIVITY_IN_WINDOW', 'SCHEDULER',
          jsonb_build_object('runId', $2, 'scheduleId', $3)
        )`,
        [eventId, run.id, run.schedule_id],
      );

      // Tạo notification intent gửi tới người được giám sát (resident)
      await client.query(
        `INSERT INTO notifications (
          event_id, recipient_user_id, channel, status, escalation_level, payload
        ) VALUES (
          $1, $2, 'TELEGRAM', 'PENDING', 0,
          jsonb_build_object('eventType', 'WELLNESS_TIMEOUT', 'priority', 'P2', 'checkId', $3)
        )`,
        [eventId, run.resident_user_id, run.id],
      );

      // Đánh dấu ALERT_CREATED và thiết lập deadline gửi ban đầu
      const deliveryDeadlineAt = new Date(now.getTime() + 60 * 1000); // 60 giây timeout gửi
      await this.repository.updateRunDecision(
        run.id,
        run.lease_token,
        'ALERT_CREATED',
        {
          decisionReason: 'Không có hoạt động hợp lệ trong khoảng thời gian quy định',
          eventId,
          presenceState: 'HOME',
          deliveryDeadlineAt,
        },
        client,
      );

      // Thiết lập luôn request_sent_at và confirmation_deadline_at cho kênh dashboard/resident
      await this.repository.recordDeliverySuccess(eventId, now, run.grace_seconds, client);

      // Cập nhật escalation_deadline_at trên event (5 phút = 300 giây)
      const confirmationDeadline = new Date(now.getTime() + run.grace_seconds * 1000);
      await client.query(`UPDATE events SET escalation_deadline_at = $2 WHERE id = $1`, [
        eventId,
        confirmationDeadline,
      ]);

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      this.logger.error(`Lỗi khi đánh giá wellness run ${run.id}`, err);
    } finally {
      client.release();
    }
  }

  /**
   * Quét và xử lý tự động các lượt kiểm tra quá hạn xác nhận 5 phút -> Escalate sang Caregiver
   */
  async processTimeouts(): Promise<void> {
    const client = await this.repository.getPoolClient();
    try {
      await client.query('BEGIN');

      const now = new Date();

      // Tìm các events WELLNESS_TIMEOUT quá hạn deadline 5 phút mà chưa phản hồi
      const dueRes = await client.query(
        `SELECT e.id, e.wellness_owner_user_id, e.wellness_resident_user_id, e.escalation_deadline_at, r.id AS run_id
         FROM events e
         LEFT JOIN wellness_check_runs r ON r.event_id = e.id
         WHERE e.event_type = 'WELLNESS_TIMEOUT'
           AND e.status = 'NOTIFIED'
           AND e.escalation_deadline_at IS NOT NULL
           AND e.escalation_deadline_at <= $1
         FOR UPDATE OF e SKIP LOCKED
         LIMIT $2`,
        [now, this.batchSize],
      );

      for (const row of dueRes.rows) {
        this.logger.warn(
          `Sự kiện wellness ${row.id} đã hết 5 phút mà người nhà không xác nhận. Tự động ESCALATE tới Caregiver!`,
        );

        await client.query(
          `UPDATE events
           SET status = 'ESCALATED', escalated_at = now(), escalation_deadline_at = NULL, version = version + 1
           WHERE id = $1`,
          [row.id],
        );

        await client.query(
          `INSERT INTO event_status_history (
            event_id, from_status, to_status, reason, actor_type, metadata
          ) VALUES (
            $1, 'NOTIFIED', 'ESCALATED', 'TIMEOUT', 'SYSTEM',
            jsonb_build_object('timeoutSeconds', 300, 'recovered', true)
          )`,
          [row.id],
        );

        // Tạo thông báo khẩn cấp gửi tới Caregiver (chủ hộ)
        if (row.wellness_owner_user_id) {
          await client.query(
            `INSERT INTO notifications (
              event_id, recipient_user_id, channel, status, escalation_level, payload
            ) VALUES (
              $1, $2, 'TELEGRAM', 'PENDING', 1,
              jsonb_build_object(
                'reason', 'WELLNESS_TIMEOUT_NO_RESPONSE',
                'priority', 'P2',
                'residentUserId', row.wellness_resident_user_id
              )
            )`,
            [row.id, row.wellness_owner_user_id],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      this.logger.error('Lỗi khi quét deadline timeout wellness', err);
    } finally {
      client.release();
    }
  }

  /**
   * Tính toán thời điểm chạy tiếp theo dựa trên múi giờ và cấu hình lịch
   */
  computeScheduleOccurrence(
    schedule: WellnessScheduleRecord,
    now: Date,
  ): {
    localDate: string;
    scheduledFor: Date;
    lookbackStartedAt: Date;
    lookbackEndedAt: Date;
  } | null {
    try {
      const [hoursStr, minutesStr] = schedule.check_at.split(':');
      const targetHours = parseInt(hoursStr, 10);
      const targetMinutes = parseInt(minutesStr, 10);

      // Định dạng ngày theo múi giờ chỉ định
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: schedule.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const localDate = formatter.format(now); // YYYY-MM-DD

      // Lấy ngày trong tuần (1 = Thứ Hai ... 7 = Chủ Nhật)
      const dayOfWeekFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: schedule.timezone,
        weekday: 'short',
      });
      const weekdayStr = dayOfWeekFormatter.format(now);
      const weekdayMap: Record<string, number> = {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
      };
      const currentDayOfWeek = weekdayMap[weekdayStr] ?? 1;

      if (!schedule.days_of_week.includes(currentDayOfWeek)) {
        return null;
      }

      // Tạo Date object tương ứng với local date và target time
      // Mặc định tạo theo chuẩn UTC approximation rồi căn chỉnh theo timezone
      const [year, month, day] = localDate.split('-').map(Number);
      const scheduledFor = new Date(Date.UTC(year, month - 1, day, targetHours, targetMinutes));

      const lookbackHours = schedule.lookback_hours ?? 6;
      const lookbackStartedAt = new Date(scheduledFor.getTime() - lookbackHours * 60 * 60 * 1000);
      const lookbackEndedAt = scheduledFor;

      return {
        localDate,
        scheduledFor,
        lookbackStartedAt,
        lookbackEndedAt,
      };
    } catch {
      return null;
    }
  }
}
