'use client';
import { Component, useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import dynamic from 'next/dynamic';
import { motion, useReducedMotion } from 'motion/react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { CAMERA_FEATURES, type CameraFeatureId } from './camera-features';
import { CameraDemoHUD } from './CameraDemoHUD';
import { CameraIllustration } from './CameraIllustration';
import { CAMERA_PARTS, type CameraCommand, type CameraPartId } from './camera-parts';
import styles from './camera-showcase.module.css';
const features = CAMERA_FEATURES;
function Poster({ message = 'Đang tải camera…' }: { message?: string }) {
  return (
    <div className={styles.poster}>
      <CameraIllustration />
      <span role="status">{message}</span>
    </div>
  );
}
const Scene = dynamic(() => import('./CameraScene'), { ssr: false, loading: () => <Poster /> });
class Boundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? (
      <Poster message="Xem các chức năng AI bên dưới" />
    ) : (
      this.props.children
    );
  }
}
interface Props {
  onNavigate?: (page: string) => void;
}
function FeatureStrip({
  activeId,
  onSelect,
  onNavigate,
}: {
  activeId: CameraFeatureId | null;
  onSelect: (item: (typeof features)[number]) => void;
  onNavigate?: (page: string) => void;
}) {
  const reduce = useReducedMotion();
  const active = features.find((item) => item.id === activeId);
  return (
    <>
      {' '}
      <div className={styles.features} role="group" aria-label="Khám phá chức năng AI">
        {features.map((item) => (
          <button
            type="button"
            key={item.id}
            data-feature={item.id}
            aria-pressed={activeId === item.id}
            className={styles.feature}
            onClick={() => onSelect(item)}
          >
            {activeId === item.id && (
              <motion.span
                layoutId="ai-feature-selected"
                className={styles.featureBackground}
                transition={
                  reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 35 }
                }
              />
            )}
            <span className={styles.featureIcon}>
              <Icon name={item.icon as IconName} size={19} />
            </span>
            <span>{item.title}</span>
          </button>
        ))}
      </div>
      <div className={styles.featureDetail}>
        <p key={active?.id ?? 'overview'}>
          {active?.description ??
            'Chọn một chức năng để xem camera quan sát, nhận diện và minh họa tình huống tương ứng.'}
        </p>
        <button type="button" onClick={() => onNavigate?.(active?.page ?? 'cameras')}>
          {active?.action ?? 'Xem camera'}
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </>
  );
}

function useWebGL() {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    setWebgl(Boolean(context));
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  }, []);
  return { webgl, setWebgl };
}

type SceneProps = ComponentProps<typeof Scene>;
function ShowcaseHeader({ feature, exploded }: Pick<SceneProps, 'feature' | 'exploded'>) {
  return (
    <div className={styles.heroTop}>
      <span className={styles.productTag}>
        <Icon name="aperture" size={14} /> CameraAI Vision
      </span>
      <span className={styles.viewState} aria-live="polite">
        <span />
        {feature
          ? 'Đang mô phỏng chức năng AI'
          : exploded
            ? 'Bên trong hệ thống'
            : 'Góc nhìn thông minh'}
      </span>
    </div>
  );
}
function CameraIntro({
  available,
  exploded,
  onNavigate,
  onToggle,
}: {
  available: boolean;
  exploded: boolean;
  onNavigate: () => void;
  onToggle: () => void;
}) {
  return (
    <div className={styles.copy}>
      <span className={styles.eyebrow}>Từ hình ảnh đến cảnh báo</span>
      <h2 id="camera-intelligence-title">
        Một góc nhìn.
        <br />
        Nhiều lớp bảo vệ.
      </h2>
      <p>Khám phá cách CameraAI quan sát, phân tích và kết nối bạn với điều đang xảy ra.</p>
      <button type="button" className={styles.openCamera} onClick={onNavigate}>
        <Icon name="camera" size={17} />
        Mở camera trực tiếp
        <Icon name="external" size={15} />
      </button>
      <button
        type="button"
        className={styles.explore}
        disabled={!available}
        onClick={onToggle}
        aria-pressed={exploded}
      >
        <Icon name="layers" size={15} />
        {exploded ? 'Lắp lại camera' : 'Khám phá bên trong'}
      </button>
    </div>
  );
}
function CameraViewport({
  webgl,
  setWebgl,
  sceneProps,
  onClose,
  onCommand,
  available,
  partName,
}: {
  webgl: boolean | null;
  setWebgl: (value: boolean) => void;
  sceneProps: SceneProps;
  onClose: () => void;
  onCommand: (action: CameraCommand['action']) => void;
  available: boolean;
  partName?: string;
}) {
  const { feature, exploded } = sceneProps;
  return (
    <div className={styles.visual}>
      <div className={styles.orbit} aria-hidden="true" />
      <div className={styles.scene}>
        {webgl === null ? (
          <Poster />
        ) : webgl ? (
          <Boundary onError={() => setWebgl(false)}>
            <Scene {...sceneProps} />
          </Boundary>
        ) : (
          <Poster message="Thiết bị chưa hỗ trợ 3D. Bạn vẫn có thể khám phá các chức năng bên dưới." />
        )}
      </div>
      <CameraDemoHUD feature={feature} onClose={() => onClose()} />
      <div className={styles.sceneTools} aria-label="Điều khiển camera 3D">
        {(
          [
            { action: 'left', icon: 'rotate', label: 'Xoay camera' },
            { action: 'in', icon: 'zoom-in', label: 'Phóng to' },
            { action: 'out', icon: 'zoom-out', label: 'Thu nhỏ' },
            { action: 'reset', icon: 'reset', label: 'Đặt lại góc nhìn' },
          ] as const
        ).map((item) => (
          <button
            type="button"
            key={item.action}
            aria-label={item.label}
            title={item.label}
            disabled={!available}
            onClick={() => {
              onCommand(item.action);
            }}
          >
            <Icon name={item.icon} size={15} />
          </button>
        ))}
      </div>
      <span className={styles.hint}>
        <Icon name="rotate" size={12} />
        {exploded ? partName : 'Nhấn để tách · Kéo để xoay'}
      </span>
    </div>
  );
}
export function CameraShowcase({ onNavigate }: Props) {
  const [exploded, setExploded] = useState(false),
    [selected, setSelected] = useState<CameraPartId>('processor'),
    [feature, setFeature] = useState<CameraFeatureId | null>(null),
    [ready, setReady] = useState(false);
  const { webgl, setWebgl } = useWebGL();
  const [command, setCommand] = useState<CameraCommand>({ id: 0, action: 'reset' });
  const reduce = useReducedMotion();
  const send = (action: CameraCommand['action']) =>
    setCommand((current) => ({ id: current.id + 1, action }));
  const toggle = () => {
    setFeature(null);
    setExploded((value) => !value);
  };
  const control = (action: CameraCommand['action']) => {
    if (action === 'reset') {
      setFeature(null);
      setExploded(false);
    }
    send(action);
  };
  const part = CAMERA_PARTS.find((item) => item.id === selected);
  const available = webgl === true && ready;
  return (
    <section
      data-camera-mode={feature ?? (exploded ? 'exploded' : 'assembled')}
      className={styles.hero}
      aria-labelledby="camera-intelligence-title"
    >
      <ShowcaseHeader feature={feature} exploded={exploded} />
      <div className={styles.main}>
        <CameraIntro
          available={available}
          exploded={exploded}
          onNavigate={() => onNavigate?.('cameras')}
          onToggle={toggle}
        />
        <CameraViewport
          webgl={webgl}
          setWebgl={setWebgl}
          available={available}
          partName={part?.name}
          onClose={() => setFeature(null)}
          onCommand={control}
          sceneProps={{
            feature,
            exploded,
            selected,
            onSelect: setSelected,
            onToggle: toggle,
            reducedMotion: Boolean(reduce),
            autoRotate: false,
            command,
            onUnavailable: () => setWebgl(false),
            onReady: () => setReady(true),
          }}
        />
      </div>
      <FeatureStrip
        activeId={feature}
        onSelect={(item) => {
          setFeature(item.id);
          setSelected(item.part);
          setExploded(false);
          send('reset');
        }}
        onNavigate={onNavigate}
      />
      <span className={styles.caption}>
        Các cảnh mô phỏng giúp khám phá chức năng AI. Dữ liệu giám sát thực tế nằm trong mục Sự
        kiện.
      </span>
    </section>
  );
}
