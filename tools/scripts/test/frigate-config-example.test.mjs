/**
 * Kiểm tra tính nhất quán của infra/frigate/config.example.yml với AC của US-01/US-02
 * và với các file hạ tầng khác. Lỗi ở đây trước kia chỉ lộ ra khi `docker compose up`
 * — Frigate chạy với cấu hình sai mà không báo lỗi.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readRepoFile = (...pathSegments) => readFileSync(join(ROOT_DIR, ...pathSegments), 'utf8');

// Ràng buộc lấy từ tài liệu, đặt tên để biết con số đến từ đâu
const AC_US01_MIN_PRESENCE_SECONDS = 1;
const AC_US01_MAX_FRAME_LOSS_SECONDS = 30;
const FRIGATE_WATCHDOG_NO_FRAME_SECONDS = 20; // hard-code trong frigate/video/ffmpeg.py
const FRIGATE_MIN_INITIALIZED_LOWER_BOUND = 2; // Field(ge=2) trong frigate/config/camera/detect.py
const AC_US02_MIN_SCORE = 0.5; // DATA_FLOW Luồng 1: "min_score 0.5"
const SLUG_PATTERN = /^[a-z][a-z0-9_]{2,63}$/; // api/openapi.yaml + db cameras_slug_format

describe('config.example.yml của Frigate', () => {
  let config;
  let compose;
  let frigateService;
  let mediamtx;

  before(() => {
    config = parse(readRepoFile('infra', 'frigate', 'config.example.yml'));
    compose = parse(readRepoFile('docker-compose.yml'));
    frigateService = compose.services.frigate;
    mediamtx = parse(readRepoFile('infra', 'mediamtx', 'mediamtx.yml'));
  });

  describe('phiên bản', () => {
    it('ghim image Frigate theo phiên bản cụ thể, không dùng stable/latest', () => {
      assert.match(frigateService.image, /^ghcr\.io\/blakeblackshear\/frigate:\d+\.\d+\.\d+$/);
    });

    it('version trong config khớp major.minor của image (config mount read-only)', () => {
      const [, major, minor] = frigateService.image.match(/:(\d+)\.(\d+)\./);

      assert.match(String(config.version), new RegExp(`^${major}\\.${minor}-\\d+$`));
    });

    it('mount config.yml ở chế độ read-only', () => {
      assert.ok(
        frigateService.volumes.includes('./infra/frigate/config.yml:/config/config.yml:ro'),
      );
    });

    it('config.yml sinh ra bị gitignore', () => {
      const gitignoreLines = readRepoFile('.gitignore').split(/\r?\n/);

      assert.ok(gitignoreLines.includes('infra/frigate/config.yml'));
    });

    it('DB của Frigate nằm trên một volume được mount', () => {
      const dbDirectory = dirname(config.database.path);

      assert.ok(frigateService.volumes.some((volume) => volume.endsWith(`:${dbDirectory}`)));
    });
  });

  describe('US-02 · MQTT', () => {
    it('bật MQTT và trỏ tới đúng service mosquitto trong compose', () => {
      assert.equal(config.mqtt.enabled, true);
      assert.ok(compose.services[config.mqtt.host], `không có service ${config.mqtt.host}`);
      assert.equal(config.mqtt.port, 1883);
      assert.ok(frigateService.depends_on[config.mqtt.host]);
    });

    it('topic sự kiện khớp MQTT_TOPIC_FRIGATE mà orchestrator subscribe', () => {
      const topicOrchestrator = readRepoFile('.env.example')
        .match(/^MQTT_TOPIC_FRIGATE=(.+)$/m)[1]
        .trim();

      assert.equal(`${config.mqtt.topic_prefix}/events`, topicOrchestrator);
    });

    it('bật snapshot để message có has_snapshot = true', () => {
      assert.equal(config.snapshots.enabled, true);
    });
  });

  describe('US-01 · phát hiện person', () => {
    it('theo dõi person với min_score theo AC và threshold không thấp hơn min_score', () => {
      const personFilter = config.objects.filters.person;

      assert.ok(config.objects.track.includes('person'));
      assert.equal(personFilter.min_score, AC_US02_MIN_SCORE);
      assert.ok(personFilter.threshold >= personFilter.min_score && personFilter.threshold <= 1);
      assert.ok(personFilter.min_area > 0);
    });

    it('chỉ tạo track khi người xuất hiện liên tục từ 1 giây', () => {
      const { fps, min_initialized: minInitialized } = config.detect;

      assert.ok(minInitialized >= FRIGATE_MIN_INITIALIZED_LOWER_BOUND);
      assert.ok(minInitialized / fps >= AC_US01_MIN_PRESENCE_SECONDS);
    });

    it('max_disappeared dài hơn min_initialized để không cắt một người thành nhiều track', () => {
      assert.ok(config.detect.max_disappeared > config.detect.min_initialized);
    });

    it('fps không vượt 10 theo khuyến nghị của Frigate', () => {
      assert.ok(config.detect.fps > 0 && config.detect.fps <= 10);
    });

    it('khai detect width và height cùng nhau (Frigate từ chối nếu thiếu một)', () => {
      assert.equal(config.detect.width === undefined, config.detect.height === undefined);
    });

    it('khai đúng một detector', () => {
      assert.equal(Object.keys(config.detectors).length, 1);
    });
  });

  describe('US-01 · tự kết nối lại khi mất luồng', () => {
    it('phát hiện mất frame và thử lại trong vòng 30 giây theo AC', () => {
      const retry = config.ffmpeg.retry_interval;

      assert.ok(retry > 0);
      assert.ok(FRIGATE_WATCHDOG_NO_FRAME_SECONDS + retry <= AC_US01_MAX_FRAME_LOSS_SECONDS);
    });
  });

  describe('camera', () => {
    const cameras = () => Object.entries(config.cameras);

    it('có ít nhất một camera đang bật', () => {
      assert.ok(cameras().some(([, camera]) => camera.enabled !== false));
    });

    it('tên camera là slug hợp lệ theo DB và OpenAPI', () => {
      for (const [cameraName] of cameras()) assert.match(cameraName, SLUG_PATTERN, cameraName);
    });

    it('mỗi camera có đúng một input vai trò detect', () => {
      for (const [cameraName, camera] of cameras()) {
        const detectInputs = camera.ffmpeg.inputs.filter((input) => input.roles.includes('detect'));
        assert.equal(detectInputs.length, 1, cameraName);
      }
    });

    it('input RTSP trỏ vào mediamtx với path đã khai trong mediamtx.yml', () => {
      for (const [cameraName, camera] of cameras()) {
        for (const { path } of camera.ffmpeg.inputs) {
          const pathMatch = path.match(/^rtsp:\/\/mediamtx:8554\/([a-z0-9_]+)$/);
          assert.ok(pathMatch, `${cameraName}: ${path}`);
          assert.ok(compose.services.mediamtx, 'thiếu service mediamtx');
          assert.ok(
            Object.hasOwn(mediamtx.paths, pathMatch[1]),
            `mediamtx thiếu path ${pathMatch[1]}`,
          );
        }
      }
    });

    it('không chứa credential trong URL RTSP (NFR-09)', () => {
      for (const [, camera] of cameras()) {
        for (const { path } of camera.ffmpeg.inputs) assert.doesNotMatch(path, /\/\/[^/]*@/);
      }
    });

    it('zone là đa giác ít nhất 3 điểm với tọa độ chuẩn hóa 0..1', () => {
      for (const [cameraName, camera] of cameras()) {
        for (const [zoneName, zone] of Object.entries(camera.zones ?? {})) {
          assert.match(zoneName, SLUG_PATTERN, `${cameraName}.${zoneName}`);
          const coordinates = String(zone.coordinates).split(',').map(Number);
          assert.equal(coordinates.length % 2, 0, `${cameraName}.${zoneName}: số tọa độ lẻ`);
          assert.ok(coordinates.length >= 6, `${cameraName}.${zoneName}: ít hơn 3 điểm`);
          assert.ok(
            coordinates.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
            `${cameraName}.${zoneName}: tọa độ ngoài 0..1`,
          );
        }
      }
    });
  });
});
