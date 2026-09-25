'use client';

import { useEffect, useState } from 'react';
import type { Camera, UpdateCameraRequest } from '@/types';
import { retryFrigateSync, updateCamera } from '@/lib/cameras-client';
import formStyles from './styles/camera-source-form.module.css';
import viewStyles from './styles/camera-view.module.css';

interface CameraSettingsPanelProps {
  camera: Camera;
  isAdmin: boolean;
  onSynced?: () => void;
}

const DEFAULT_SETTINGS: UpdateCameraRequest = {
  detectWidth: 1280,
  detectHeight: 720,
  fps: 5,
  detectionEnabled: true,
  recordingEnabled: true,
  retentionDays: 7,
  detectionRetentionDays: 7,
  personMinScore: 0.5,
  personThreshold: 0.7,
  personMinArea: 1500,
  minInitializedFrames: 5,
  maxDisappearedFrames: 25,
  snapshotsEnabled: true,
  snapshotBoundingBox: true,
};

function settingsFromCamera(camera: Camera): UpdateCameraRequest {
  const settings = camera.frigateSettings;
  return {
    detectWidth: settings.detectWidth,
    detectHeight: settings.detectHeight,
    fps: settings.detectFps,
    detectionEnabled: camera.detectionEnabled ?? true,
    recordingEnabled: settings.recordingEnabled,
    retentionDays: camera.retentionDays ?? settings.detectionRetentionDays,
    detectionRetentionDays: settings.detectionRetentionDays,
    personMinScore: settings.personMinScore,
    personThreshold: settings.personThreshold,
    personMinArea: settings.personMinArea,
    minInitializedFrames: settings.minInitializedFrames,
    maxDisappearedFrames: settings.maxDisappearedFrames,
    snapshotsEnabled: settings.snapshotsEnabled,
    snapshotBoundingBox: settings.snapshotBoundingBox,
  };
}

interface NumberFieldProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: NumberFieldProps) {
  return (
    <label className={formStyles.formGroup}>
      <span className={formStyles.formLabel}>{label}</span>
      <input
        className={formStyles.formInput}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className={formStyles.formHint}>{hint}</span>
    </label>
  );
}

function BooleanField({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={formStyles.toggleField}>
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

type UpdateField = <K extends keyof UpdateCameraRequest>(
  field: K,
  value: UpdateCameraRequest[K],
) => void;

interface SettingsGroupProps {
  form: UpdateCameraRequest;
  disabled: boolean;
  updateField: UpdateField;
}

function BasicSettings({ form, disabled, updateField }: SettingsGroupProps) {
  return (
    <fieldset className={formStyles.settingsGroup}>
      <legend>Cơ bản</legend>
      <div className={formStyles.settingsGrid}>
        <NumberField
          label="Chiều rộng detect"
          hint="pixel · 160–7680"
          value={form.detectWidth ?? 1280}
          min={160}
          max={7680}
          disabled={disabled}
          onChange={(value) => updateField('detectWidth', value)}
        />
        <NumberField
          label="Chiều cao detect"
          hint="pixel · 120–4320"
          value={form.detectHeight ?? 720}
          min={120}
          max={4320}
          disabled={disabled}
          onChange={(value) => updateField('detectHeight', value)}
        />
        <NumberField
          label="FPS detect"
          hint="khung hình/giây · 1–30"
          value={form.fps ?? 5}
          min={1}
          max={30}
          disabled={disabled}
          onChange={(value) => updateField('fps', value)}
        />
        <NumberField
          label="Thời gian lưu detection"
          hint="ngày · 0–90"
          value={form.detectionRetentionDays ?? 7}
          min={0}
          max={90}
          disabled={disabled}
          onChange={(value) => {
            updateField('detectionRetentionDays', value);
            updateField('retentionDays', Math.max(1, value));
          }}
        />
      </div>
      <div className={formStyles.toggleGrid}>
        <BooleanField
          label="Object detection"
          hint="Bật nhận diện đối tượng trên camera"
          checked={form.detectionEnabled ?? true}
          disabled={disabled}
          onChange={(value) => updateField('detectionEnabled', value)}
        />
        <BooleanField
          label="Recording"
          hint="Ghi lại video theo cấu hình Frigate"
          checked={form.recordingEnabled ?? true}
          disabled={disabled}
          onChange={(value) => updateField('recordingEnabled', value)}
        />
      </div>
    </fieldset>
  );
}

function PersonSettings({ form, disabled, updateField }: SettingsGroupProps) {
  return (
    <fieldset className={formStyles.settingsGroup}>
      <legend>Phát hiện person</legend>
      <div className={formStyles.settingsGrid}>
        <NumberField
          label="Minimum score"
          hint="độ tin cậy sơ bộ · 0–1"
          value={form.personMinScore ?? 0.5}
          min={0}
          max={1}
          step={0.05}
          disabled={disabled}
          onChange={(value) => updateField('personMinScore', value)}
        />
        <NumberField
          label="Threshold"
          hint="ngưỡng xác nhận · 0–1"
          value={form.personThreshold ?? 0.7}
          min={0}
          max={1}
          step={0.05}
          disabled={disabled}
          onChange={(value) => updateField('personThreshold', value)}
        />
        <NumberField
          label="Minimum area"
          hint="pixel vuông · tối thiểu 0"
          value={form.personMinArea ?? 1500}
          min={0}
          max={10000000}
          disabled={disabled}
          onChange={(value) => updateField('personMinArea', value)}
        />
        <NumberField
          label="Minimum initialized frames"
          hint="frame · 1–300"
          value={form.minInitializedFrames ?? 5}
          min={1}
          max={300}
          disabled={disabled}
          onChange={(value) => updateField('minInitializedFrames', value)}
        />
        <NumberField
          label="Maximum disappeared frames"
          hint="frame · 1–300"
          value={form.maxDisappearedFrames ?? 25}
          min={1}
          max={300}
          disabled={disabled}
          onChange={(value) => updateField('maxDisappearedFrames', value)}
        />
      </div>
    </fieldset>
  );
}

function SnapshotSettings({ form, disabled, updateField }: SettingsGroupProps) {
  return (
    <fieldset className={formStyles.settingsGroup}>
      <legend>Snapshot</legend>
      <div className={formStyles.toggleGrid}>
        <BooleanField
          label="Lưu snapshot"
          hint="Lưu ảnh khi có detection"
          checked={form.snapshotsEnabled ?? true}
          disabled={disabled}
          onChange={(value) => updateField('snapshotsEnabled', value)}
        />
        <BooleanField
          label="Hiện bounding box"
          hint="Vẽ khung đối tượng trong snapshot"
          checked={form.snapshotBoundingBox ?? true}
          disabled={disabled}
          onChange={(value) => updateField('snapshotBoundingBox', value)}
        />
      </div>
    </fieldset>
  );
}

export function CameraSettingsPanel({ camera, isAdmin, onSynced }: CameraSettingsPanelProps) {
  const [form, setForm] = useState<UpdateCameraRequest>(() => settingsFromCamera(camera));
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(settingsFromCamera(camera));
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [camera]);

  const updateField = <K extends keyof UpdateCameraRequest>(
    field: K,
    value: UpdateCameraRequest[K],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateCamera(camera.id, form);
      setSuccessMsg('Đã lưu và đồng bộ cấu hình Frigate.');
      onSynced?.();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Không thể lưu cấu hình Frigate.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRetrySync = async () => {
    setIsRetrying(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const result = await retryFrigateSync(camera.id);
      if (result.syncStatus !== 'SYNCED') {
        setErrorMsg('Frigate chưa áp dụng được cấu hình. Hãy kiểm tra trạng thái dịch vụ.');
        return;
      }
      setSuccessMsg(`Đồng bộ Frigate thành công ở phiên bản v${result.configVersion}.`);
      onSynced?.();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Không thể đồng bộ Frigate.');
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className={formStyles.container}>
      <div className={formStyles.settingsStatus}>
        <div>
          <span>Phiên bản cấu hình</span>
          <strong>v{camera.frigateSync.configVersion}</strong>
        </div>
        <div>
          <span>Đã áp dụng</span>
          <strong>v{camera.frigateSync.appliedVersion ?? 0}</strong>
        </div>
        <div>
          <span>Trạng thái</span>
          <strong>{camera.frigateSync.status}</strong>
        </div>
      </div>

      {successMsg && <div className={formStyles.successAlert}>{successMsg}</div>}
      {errorMsg && <div className={formStyles.errorAlert}>{errorMsg}</div>}

      <BasicSettings form={form} disabled={!isAdmin} updateField={updateField} />
      <PersonSettings form={form} disabled={!isAdmin} updateField={updateField} />
      <SnapshotSettings form={form} disabled={!isAdmin} updateField={updateField} />

      {camera.frigateSync.errorMessage && (
        <div className={formStyles.errorAlert}>{camera.frigateSync.errorMessage}</div>
      )}

      {isAdmin && (
        <div className={formStyles.actionsRow}>
          <button
            type="button"
            className={formStyles.submitBtn}
            disabled={isSaving || isRetrying}
            onClick={() => void handleSave()}
          >
            {isSaving ? 'Đang lưu...' : 'Lưu và đồng bộ Frigate'}
          </button>
          <button
            type="button"
            className={viewStyles.refreshBtn}
            disabled={isSaving || isRetrying}
            onClick={() => setForm(DEFAULT_SETTINGS)}
          >
            Khôi phục mặc định
          </button>
          <button
            type="button"
            className={viewStyles.refreshBtn}
            disabled={isSaving || isRetrying}
            onClick={() => void handleRetrySync()}
          >
            {isRetrying ? 'Đang thử lại...' : 'Thử đồng bộ lại'}
          </button>
        </div>
      )}
    </div>
  );
}
