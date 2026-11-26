import { useId } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

/** Multi-tone Fluency-style flame icon with warm ember-to-gold gradient. */
export function FlameFluentIcon({ size = 24, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-outer`}
          x1="16"
          y1="3"
          x2="16"
          y2="29"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ff9f43" />
          <stop offset="52%" stopColor="#ff4d4f" />
          <stop offset="100%" stopColor="#c81d45" />
        </linearGradient>
        <linearGradient
          id={`${uid}-inner`}
          x1="16"
          y1="12"
          x2="16"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="65%" stopColor="#ffbe3d" />
          <stop offset="100%" stopColor="#ff6b35" />
        </linearGradient>
      </defs>
      <path
        d="M17.3 3.2c.4 4.2-2.4 6.7-4.3 8.8-1.8 2-2.6 3.7-2.4 5.5-.9-.8-1.5-2-1.7-3.4-.1-.6-.8-.8-1.2-.4C5.8 15.6 5 18 5 20.3 5 25.8 9.9 29 16 29s11-3.4 11-9.6c0-4.9-2.8-9.1-6.9-12.5-1.1-.9-2.1-2.1-2.1-3.5 0-.4-.7-.5-.7-.2Z"
        fill={`url(#${uid}-outer)`}
      />
      <path
        d="M16.2 12.8c.2 2.4-1.6 3.9-2.4 5.3-.9 1.4-1.3 2.7-1.3 4 0 2.9 1.8 5 4.2 5 2.7 0 4.6-2 4.6-5.2 0-2.6-1.4-4.9-3.6-7.2-.6-.6-1.2-1.2-1.2-1.8 0-.3-.3-.3-.3-.1Z"
        fill={`url(#${uid}-inner)`}
      />
      <ellipse cx="16.4" cy="24.2" rx="1.9" ry="2.4" fill="#fff9db" fillOpacity="0.9" />
    </svg>
  );
}

/** Multi-tone emergency beacon siren icon with radiant light beams. */
export function SirenFluentIcon({ size = 20, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-dome`}
          x1="16"
          y1="9"
          x2="16"
          y2="23"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ff7a8a" />
          <stop offset="55%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#be123c" />
        </linearGradient>
        <linearGradient
          id={`${uid}-base`}
          x1="6"
          y1="23"
          x2="26"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#4c3568" />
          <stop offset="100%" stopColor="#26183b" />
        </linearGradient>
      </defs>
      <path
        d="M16 3v3M6.5 7.5l2.2 2.2M25.5 7.5l-2.2 2.2M3 16h3M26 16h3"
        stroke="#ffb454"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M9 22.5V16a7 7 0 0 1 14 0v6.5H9Z" fill={`url(#${uid}-dome)`} />
      <path
        d="M12.5 15.5a3.5 3.5 0 0 1 3.5-3.5"
        stroke="#fff"
        strokeOpacity="0.7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="6" y="22.5" width="20" height="4.8" rx="2.4" fill={`url(#${uid}-base)`} />
    </svg>
  );
}

/** Multi-tone emerald shield icon for safe confirmation. */
export function ShieldCheckFluentIcon({ size = 20, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-shield`}
          x1="6"
          y1="4"
          x2="26"
          y2="29"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="55%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
      </defs>
      <path
        d="M16 3.5 5.5 7.6v7.6c0 6.7 4.4 11.7 10.5 13.8 6.1-2.1 10.5-7.1 10.5-13.8V7.6L16 3.5Z"
        fill={`url(#${uid}-shield)`}
      />
      <path
        d="M16 5.5 7.5 8.8v6.2c0 1.4.2 2.8.6 4.1 3.2-2.7 7.6-4.7 16.4-5.7V8.8L16 5.5Z"
        fill="#fff"
        fillOpacity="0.16"
      />
      <path
        d="m11.6 16.4 3 3 6-6.3"
        stroke="#fff"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Multi-tone emergency telephone icon for 114 action. */
export function EmergencyPhoneFluentIcon({ size = 20, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-phone`}
          x1="5"
          y1="6"
          x2="26"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ff6b7d" />
          <stop offset="100%" stopColor="#c81d45" />
        </linearGradient>
      </defs>
      <path
        d="M25.6 20.6c-1.4-.4-2.8-.9-4-1.5-.8-.4-1.7-.2-2.3.4l-1.5 1.5a15.2 15.2 0 0 1-6.8-6.8l1.5-1.5c.6-.6.8-1.5.4-2.3-.6-1.2-1.1-2.6-1.5-4-.3-1-1.2-1.7-2.2-1.7H6.6C5.2 4.7 4.1 5.9 4.3 7.3 5.5 17.6 14.4 26.5 24.7 27.7c1.4.2 2.6-.9 2.6-2.3v-2.6c0-1-.7-1.9-1.7-2.2Z"
        fill={`url(#${uid}-phone)`}
      />
      <path
        d="M18.5 6.8a7 7 0 0 1 6.7 6.7"
        stroke="#ff9f43"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M18.5 10.8a3 3 0 0 1 2.7 2.7"
        stroke="#f43f5e"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Multi-tone Argus camera lens icon. */
export function CameraLensFluentIcon({ size = 18, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-body`}
          x1="4"
          y1="8"
          x2="28"
          y2="25"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#9b6cf3" />
          <stop offset="100%" stopColor="#6533c2" />
        </linearGradient>
        <linearGradient
          id={`${uid}-lens`}
          x1="10"
          y1="12"
          x2="20"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#312e81" />
        </linearGradient>
      </defs>
      <rect x="3.5" y="8.5" width="18.5" height="15" rx="4.5" fill={`url(#${uid}-body)`} />
      <path
        d="M22 13.3 27.2 10c.9-.6 2 .1 2 1.1v9.8c0 1-1.1 1.7-2 1.1L22 18.7v-5.4Z"
        fill="#7c4de0"
      />
      <circle
        cx="12.8"
        cy="16"
        r="4.5"
        fill={`url(#${uid}-lens)`}
        stroke="#ede9fe"
        strokeWidth="1.6"
      />
      <circle cx="11.5" cy="14.5" r="1.2" fill="#fff" fillOpacity="0.85" />
    </svg>
  );
}

/** Multi-tone map pin icon for monitoring zone. */
export function ZonePinFluentIcon({ size = 18, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-pin`}
          x1="8"
          y1="4"
          x2="24"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <path
        d="M16 3.5c-5.4 0-9.7 4.2-9.7 9.5 0 6.8 8.3 14.3 9.1 15 .4.3.9.3 1.3 0 .8-.7 9.1-8.2 9.1-15 0-5.3-4.3-9.5-9.8-9.5Z"
        fill={`url(#${uid}-pin)`}
      />
      <circle cx="16" cy="13" r="3.8" fill="#fff" />
    </svg>
  );
}

/** Multi-tone clock icon for incident timestamps. */
export function ClockFluentIcon({ size = 18, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-face`}
          x1="5"
          y1="5"
          x2="27"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f3e8ff" />
          <stop offset="100%" stopColor="#ddd6fe" />
        </linearGradient>
        <linearGradient
          id={`${uid}-rim`}
          x1="4"
          y1="4"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#5b21b6" />
        </linearGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r="12"
        fill={`url(#${uid}-face)`}
        stroke={`url(#${uid}-rim)`}
        strokeWidth="2.4"
      />
      <path
        d="M16 10v6.2l4.2 2.4"
        stroke="#5b21b6"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="1.6" fill="#e11d48" />
    </svg>
  );
}

/** Multi-tone snapshot frame icon with detection focus box. */
export function SnapshotFrameFluentIcon({ size = 18, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-bg`}
          x1="4"
          y1="6"
          x2="28"
          y2="26"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#fda4af" />
          <stop offset="100%" stopColor="#e11d48" />
        </linearGradient>
      </defs>
      <rect x="4" y="6" width="24" height="20" rx="5" fill={`url(#${uid}-bg)`} />
      <path
        d="M10 14v-2a2 2 0 0 1 2-2h2M22 14v-2a2 2 0 0 0-2-2h-2M10 18v2a2 2 0 0 0 2 2h2M22 18v2a2 2 0 0 1-2 2h-2"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.6" fill="#fde047" />
    </svg>
  );
}

/** Multi-tone video playback reel icon. */
export function VideoReelFluentIcon({ size = 18, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-vid`}
          x1="4"
          y1="6"
          x2="28"
          y2="26"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <rect x="4" y="6" width="24" height="20" rx="5" fill={`url(#${uid}-vid)`} />
      <path d="m13.5 11.8 7.5 4.2-7.5 4.2v-8.4Z" fill="#fff" />
    </svg>
  );
}

/** Multi-tone flag icon for false alarm toggle. */
export function FlagAlertFluentIcon({ size = 18, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-flag`}
          x1="8"
          y1="5"
          x2="25"
          y2="19"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
      </defs>
      <path d="M8 5v22" stroke="#64557a" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M9.2 6.2h14.4c1 0 1.5 1.1.9 1.9l-2.6 3.5 2.6 3.5c.6.8.1 1.9-.9 1.9H9.2V6.2Z"
        fill={`url(#${uid}-flag)`}
      />
    </svg>
  );
}

/** Multi-tone verified badge for resolved/closed events. */
export function CheckBadgeFluentIcon({ size = 20, className }: IconProps) {
  const uid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${uid}-badge`}
          x1="5"
          y1="5"
          x2="27"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="12" fill={`url(#${uid}-badge)`} />
      <path
        d="m11 16.4 3.2 3.2 6.8-7"
        stroke="#fff"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Colorful channel-specific Fluency icon for notification delivery cards. */
export function ChannelFluentIcon({
  channel,
  size = 20,
}: {
  channel: 'TELEGRAM' | 'SNS_EMAIL' | 'SNS_SMS' | 'CONNECT_CALL' | 'DASHBOARD' | 'WEBHOOK';
  size?: number;
}) {
  const uid = useId();
  if (channel === 'TELEGRAM') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id={`${uid}-tg`}
            x1="4"
            y1="4"
            x2="28"
            y2="28"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="13" fill={`url(#${uid}-tg)`} />
        <path
          d="m22.2 10.6-2.4 11.4c-.2.8-.7 1-1.4.6l-3.7-2.7-1.8 1.7c-.2.2-.4.4-.8.4l.3-3.8 6.9-6.2c.3-.3-.1-.4-.5-.2l-8.5 5.4-3.7-1.1c-.8-.2-.8-.8.2-1.2l14.3-5.5c.7-.2 1.3.2 1.1 1.2Z"
          fill="#fff"
        />
      </svg>
    );
  }
  if (channel === 'CONNECT_CALL') {
    return <EmergencyPhoneFluentIcon size={size} />;
  }
  if (channel === 'SNS_SMS') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id={`${uid}-sms`}
            x1="4"
            y1="5"
            x2="28"
            y2="27"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        <path
          d="M6 7.5A3.5 3.5 0 0 1 9.5 4h13A3.5 3.5 0 0 1 26 7.5v11A3.5 3.5 0 0 1 22.5 22h-8l-5.3 4.4c-.6.5-1.5.1-1.5-.7V22A3.5 3.5 0 0 1 6 18.5v-11Z"
          fill={`url(#${uid}-sms)`}
        />
        <circle cx="12" cy="13" r="1.5" fill="#fff" />
        <circle cx="16" cy="13" r="1.5" fill="#fff" />
        <circle cx="20" cy="13" r="1.5" fill="#fff" />
      </svg>
    );
  }
  if (channel === 'SNS_EMAIL') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id={`${uid}-mail`}
            x1="4"
            y1="6"
            x2="28"
            y2="26"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
        </defs>
        <rect x="4" y="7" width="24" height="18" rx="4" fill={`url(#${uid}-mail)`} />
        <path
          d="m6.5 10 9.5 6.8L25.5 10"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${uid}-sys`}
          x1="4"
          y1="5"
          x2="28"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect x="4" y="6" width="24" height="17" rx="4" fill={`url(#${uid}-sys)`} />
      <path d="M12 26h8M16 23v3" stroke="#6366f1" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
