'use client';
import { motion } from 'motion/react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { CAMERA_FEATURES, type CameraFeatureId } from './camera-features';
import styles from './camera-showcase.module.css';
export function CameraDemoHUD({
  feature,
  onClose,
}: {
  feature: CameraFeatureId | null;
  onClose: () => void;
}) {
  const mode = CAMERA_FEATURES.find((item) => item.id === feature);
  if (!mode) return null;
  return (
    <>
      <motion.div
        key={mode.id}
        className={styles.sceneMessage}
        data-demo={mode.id}
        role="status"
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <span>Cảnh mô phỏng · {mode.title}</span>
        <strong>
          <Icon name={mode.icon as IconName} size={17} />
          {mode.result}
        </strong>
        <small>{mode.detail}</small>
      </motion.div>
      <button
        type="button"
        className={styles.simulationClose}
        aria-label="Đóng mô phỏng"
        title="Đóng mô phỏng"
        onClick={onClose}
      >
        <Icon name="close" size={16} />
      </button>
    </>
  );
}
