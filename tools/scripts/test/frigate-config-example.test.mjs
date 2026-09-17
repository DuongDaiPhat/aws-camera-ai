/**
 * Kiem tra tinh nhat quan cua infra/frigate/config.example.yml voi AC cua US-01/US-02
 * va voi cac file ha tang khac. Loi o day truoc day chi lo ra khi `docker compose up`
 * — Frigate chay voi cau hinh sai ma khong bao loi.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const docTep = (...duongDan) => readFileSync(join(ROOT, ...duongDan), 'utf8');

// Rang buoc tu tai lieu, dat ten de biet con so lay tu dau
const AC_US01_NGUOI_XUAT_HIEN_TOI_THIEU_GIAY = 1;
const AC_US01_MAT_FRAME_TOI_DA_GIAY = 30;
const FRIGATE_WATCHDOG_KHONG_CO_FRAME_GIAY = 20; // hard-code trong frigate/video/ffmpeg.py
const FRIGATE_MIN_INITIALIZED_TOI_THIEU = 2; // Field(ge=2) trong frigate/config/camera/detect.py
const AC_US02_MIN_SCORE = 0.5; // DATA_FLOW Luong 1: "min_score 0.5"
const SLUG_CAMERA = /^[a-z][a-z0-9_]{2,63}$/; // api/openapi.yaml + db cameras_slug_format

describe('config.example.yml của Frigate', () => {
  let config;
  let compose;
  let frigateService;
  let mediamtx;

  before(() => {
    config = parse(docTep('infra', 'frigate', 'config.example.yml'));
    compose = parse(docTep('docker-compose.yml'));
    frigateService = compose.services.frigate;
    mediamtx = parse(docTep('infra', 'mediamtx', 'mediamtx.yml'));
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
      const dongGitignore = docTep('.gitignore').split(/\r?\n/);

      assert.ok(dongGitignore.includes('infra/frigate/config.yml'));
    });

    it('DB của Frigate nằm trên một volume được mount', () => {
      const thuMucDb = dirname(config.database.path);

      assert.ok(frigateService.volumes.some((volume) => volume.endsWith(`:${thuMucDb}`)));
    });
  });

  describe('US-02 · MQTT', () => {
    it('bật MQTT và trỏ tới đúng service mosquitto trong compose', () => {
      assert.equal(config.mqtt.enabled, true);
      assert.ok(compose.services[config.mqtt.host], `khong co service ${config.mqtt.host}`);
      assert.equal(config.mqtt.port, 1883);
      assert.ok(frigateService.depends_on[config.mqtt.host]);
    });

    it('topic sự kiện khớp MQTT_TOPIC_FRIGATE mà orchestrator subscribe', () => {
      const topicOrchestrator = docTep('.env.example')
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
      const boLoc = config.objects.filters.person;

      assert.ok(config.objects.track.includes('person'));
      assert.equal(boLoc.min_score, AC_US02_MIN_SCORE);
      assert.ok(boLoc.threshold >= boLoc.min_score && boLoc.threshold <= 1);
      assert.ok(boLoc.min_area > 0);
    });

    it('chỉ tạo track khi người xuất hiện liên tục từ 1 giây', () => {
      const { fps, min_initialized: minInitialized } = config.detect;

      assert.ok(minInitialized >= FRIGATE_MIN_INITIALIZED_TOI_THIEU);
      assert.ok(minInitialized / fps >= AC_US01_NGUOI_XUAT_HIEN_TOI_THIEU_GIAY);
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
      assert.ok(FRIGATE_WATCHDOG_KHONG_CO_FRAME_GIAY + retry <= AC_US01_MAT_FRAME_TOI_DA_GIAY);
    });
  });

  describe('camera', () => {
    const cameras = () => Object.entries(config.cameras);

    it('có ít nhất một camera đang bật', () => {
      assert.ok(cameras().some(([, camera]) => camera.enabled !== false));
    });

    it('tên camera là slug hợp lệ theo DB và OpenAPI', () => {
      for (const [ten] of cameras()) assert.match(ten, SLUG_CAMERA, ten);
    });

    it('mỗi camera có đúng một input vai trò detect', () => {
      for (const [ten, camera] of cameras()) {
        const soDetect = camera.ffmpeg.inputs.filter((input) => input.roles.includes('detect'));
        assert.equal(soDetect.length, 1, ten);
      }
    });

    it('input RTSP trỏ vào mediamtx với path đã khai trong mediamtx.yml', () => {
      for (const [ten, camera] of cameras()) {
        for (const { path } of camera.ffmpeg.inputs) {
          const khop = path.match(/^rtsp:\/\/mediamtx:8554\/([a-z0-9_]+)$/);
          assert.ok(khop, `${ten}: ${path}`);
          assert.ok(compose.services.mediamtx, 'thieu service mediamtx');
          assert.ok(Object.hasOwn(mediamtx.paths, khop[1]), `mediamtx thieu path ${khop[1]}`);
        }
      }
    });

    it('không chứa credential trong URL RTSP (NFR-09)', () => {
      for (const [, camera] of cameras()) {
        for (const { path } of camera.ffmpeg.inputs) assert.doesNotMatch(path, /\/\/[^/]*@/);
      }
    });

    it('zone là đa giác ít nhất 3 điểm với tọa độ chuẩn hóa 0..1', () => {
      for (const [ten, camera] of cameras()) {
        for (const [tenZone, zone] of Object.entries(camera.zones ?? {})) {
          assert.match(tenZone, SLUG_CAMERA, `${ten}.${tenZone}`);
          const toaDo = String(zone.coordinates).split(',').map(Number);
          assert.equal(toaDo.length % 2, 0, `${ten}.${tenZone}: so toa do le`);
          assert.ok(toaDo.length >= 6, `${ten}.${tenZone}: it hon 3 diem`);
          assert.ok(
            toaDo.every((giaTri) => Number.isFinite(giaTri) && giaTri >= 0 && giaTri <= 1),
            `${ten}.${tenZone}: toa do ngoai 0..1`,
          );
        }
      }
    });
  });
});
