import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WellnessRepository } from './wellness.repository';
import { wellnessInteger } from './wellness-policy';
import type { WellnessScheduleRecord } from './wellness.types';

@Injectable()
export class WellnessSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WellnessSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly pollMs: number;
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly catchupSeconds: number;
  private readonly reconcileSeconds: number;
  private readonly deliverySeconds: number;
  constructor(
    private readonly repository: WellnessRepository,
    private readonly config: ConfigService,
  ) {
    this.pollMs = wellnessInteger(config, 'WELLNESS_POLL_INTERVAL_MS', 5000, 60000);
    this.batchSize = wellnessInteger(config, 'WELLNESS_BATCH_SIZE', 50, 500);
    this.leaseSeconds = wellnessInteger(config, 'WELLNESS_RUN_LEASE_SECONDS', 30, 3600);
    this.catchupSeconds = wellnessInteger(config, 'WELLNESS_CATCHUP_SECONDS', 300);
    this.reconcileSeconds = wellnessInteger(config, 'WELLNESS_RECONCILE_LOOKBACK_SECONDS', 86400);
    this.deliverySeconds = wellnessInteger(config, 'WELLNESS_DELIVERY_TIMEOUT_SECONDS', 60, 3600);
  }
  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Existing alerts must drain even when new admissions are disabled.
      await this.processTimeouts();
      if (String(this.config.get('M5_ENABLED', 'false')) !== 'true') return;
      await this.repository.reclaimExpiredLeases();
      await this.materializeDueOccurrences();
      await this.evaluatePendingRuns();
    } catch (error) {
      this.logger.error('Wellness scheduler tick failed', error);
    } finally {
      this.running = false;
    }
  }
  async materializeDueOccurrences(): Promise<void> {
    await this.repository.materializeOccurrences(this.reconcileSeconds, this.batchSize);
  }
  async evaluatePendingRuns(): Promise<void> {
    const runs = await this.repository.transaction((client) =>
      this.repository.claimPendingRuns(this.batchSize, this.leaseSeconds, client),
    );
    for (const run of runs) await this.evaluateSingleRun(run);
  }
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
    try {
      await this.repository.transaction(async (client) => {
        await client.query('SELECT id FROM wellness_schedules WHERE id=$1 FOR UPDATE', [
          run.schedule_id,
        ]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `${run.owner_user_id}:${run.resident_user_id}`,
        ]);
        const current = (
          await client.query(
            'SELECT lease_token,leased_until,schedule_version FROM wellness_check_runs WHERE id=$1 FOR UPDATE',
            [run.id],
          )
        ).rows[0];
        const now = await this.repository.databaseNow(client);
        if (!current || current.lease_token !== run.lease_token || current.leased_until <= now)
          return;
        const schedule = await this.repository.getScheduleById(run.schedule_id, client);
        const decide = async (
          status: Parameters<WellnessRepository['updateRunDecision']>[2],
          options: Parameters<WellnessRepository['updateRunDecision']>[3] = {},
        ): Promise<void> => {
          await this.repository.updateRunDecision(
            run.id,
            run.lease_token!,
            status,
            { ...options, evaluatedAt: now },
            client,
          );
          await client.query('UPDATE wellness_schedules SET last_checked_at=$2 WHERE id=$1', [
            run.schedule_id,
            now,
          ]);
        };
        if (!schedule?.is_enabled || schedule.deleted_at) {
          await decide('SKIPPED_DISABLED');
          return;
        }
        if (schedule.version !== current.schedule_version) {
          await decide('SKIPPED_SUPERSEDED', { decisionReason: 'Schedule configuration changed' });
          return;
        }
        if (now.getTime() - new Date(run.scheduled_for).getTime() > this.catchupSeconds * 1000) {
          await decide('MISSED', { decisionReason: 'Scheduler catch-up window exceeded' });
          this.logger.warn(`Wellness occurrence MISSED runId=${run.id}`);
          return;
        }
        if (
          !(await this.repository.verifyResidentHouseholdLink(
            run.owner_user_id,
            run.resident_user_id,
            client,
          ))
        )
          throw new Error('Resident household link is no longer valid');
        const presence = await this.repository.getPresenceState(
          run.owner_user_id,
          run.resident_user_id,
          new Date(run.scheduled_for),
          client,
        );
        if (presence === 'AWAY') {
          await decide('SKIPPED_AWAY', { presenceState: 'AWAY' });
          return;
        }
        const cameras = Array.isArray(run.schedule_snapshot.cameraIds)
          ? run.schedule_snapshot.cameraIds.filter((id): id is string => typeof id === 'string')
          : [];
        const activity = cameras.length
          ? await this.repository.findActivityInWindow(
              run.owner_user_id,
              run.resident_user_id,
              cameras,
              new Date(run.lookback_started_at),
              new Date(run.lookback_ended_at),
              client,
            )
          : null;
        if (activity) {
          await decide('SKIPPED_ACTIVITY', { lastActivityAt: activity, presenceState: 'HOME' });
          return;
        }
        if (
          await this.repository.hasActiveUnresolvedWellnessEvent(
            run.owner_user_id,
            run.resident_user_id,
            client,
          )
        ) {
          await decide('SKIPPED_SUPERSEDED', {
            decisionReason: 'An active resident request already exists',
          });
          return;
        }
        const event = (
          await client.query(
            `INSERT INTO events(event_type,status,priority,source,detected_at,notified_at,
          wellness_owner_user_id,wellness_resident_user_id,dedup_key,rule_snapshot,aggregate_version)
          VALUES('WELLNESS_TIMEOUT','NOTIFIED','P2','SCHEDULER',$1,$1,$2,$3,$4,$5::jsonb,1) RETURNING id`,
            [
              now,
              run.owner_user_id,
              run.resident_user_id,
              `m5-wellness:${run.schedule_id}:${new Date(run.scheduled_for).toISOString()}`,
              JSON.stringify({
                priority: 'P2',
                graceSeconds: run.grace_seconds,
                residentUserId: run.resident_user_id,
                ownerUserId: run.owner_user_id,
              }),
            ],
          )
        ).rows[0];
        await client.query(
          `INSERT INTO event_status_history(event_id,from_status,to_status,reason,actor_type,metadata)
          VALUES($1,'DETECTED','NOTIFIED','NO_ACTIVITY_IN_WINDOW','SCHEDULER',jsonb_build_object('runId',$2::text,'scheduleId',$3::text))`,
          [event.id, run.id, run.schedule_id],
        );
        await client.query(
          `INSERT INTO notifications(event_id,recipient_user_id,channel,status,escalation_level,payload)
          VALUES($1,$2,'TELEGRAM','PENDING',0,jsonb_build_object('eventType','WELLNESS_TIMEOUT','priority','P2','checkId',$3::text))`,
          [event.id, run.resident_user_id, run.id],
        );
        await decide('ALERT_CREATED', {
          eventId: event.id,
          presenceState: presence,
          deliveryDeadlineAt: new Date(now.getTime() + this.deliverySeconds * 1000),
        });
        await this.repository.enqueueEventUpdate(event.id, client);
      });
    } catch (error) {
      this.logger.error(`Wellness evaluation failed runId=${run.id}`, error);
      await this.repository.retryRun(
        run.id,
        run.lease_token,
        error instanceof Error ? error.message : 'Evaluation failed',
      );
    }
  }
  async processTimeouts(): Promise<void> {
    await this.repository.processWellnessTimeouts(this.batchSize);
  }

  /** Unit-testable civil-time calculation. Admission itself uses PostgreSQL AT TIME ZONE. */
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
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: schedule.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const date = formatter.format(now),
        [year, month, day] = date.split('-').map(Number),
        [hour, minute] = schedule.check_at.split(':').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
      if (!schedule.days_of_week.includes(weekday)) return null;
      const local = Date.UTC(year, month - 1, day, hour, minute);
      const partsFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: schedule.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      const parts = (value: number): number => {
        const p = Object.fromEntries(
          partsFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
        );
        return Date.UTC(
          Number(p.year),
          Number(p.month) - 1,
          Number(p.day),
          Number(p.hour),
          Number(p.minute),
          Number(p.second),
        );
      };
      const offsets = new Set(
        [-36, 0, 36].map((hours) => {
          const value = local + hours * 3600000;
          return parts(value) - value;
        }),
      );
      const candidates = [...offsets].map((offset) => local - offset);
      const exact = candidates.filter((value) => parts(value) === local);
      // PostgreSQL chooses the later instant for a fold; a gap uses the pre-transition offset.
      const scheduledFor = new Date(Math.max(...(exact.length ? exact : candidates)));
      return {
        localDate: date,
        scheduledFor,
        lookbackStartedAt: new Date(scheduledFor.getTime() - schedule.lookback_hours * 3600000),
        lookbackEndedAt: scheduledFor,
      };
    } catch {
      return null;
    }
  }
}
