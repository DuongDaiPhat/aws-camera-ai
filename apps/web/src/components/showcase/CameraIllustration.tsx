export function CameraIllustration({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 640 350"
      fill="none"
      role="img"
      aria-label="Cụm quang học CameraAI"
    >
      <defs>
        <radialGradient id="camera-aura">
          <stop stopColor="#7557d2" stopOpacity=".35" />
          <stop offset="1" stopColor="#7557d2" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id="camera-metal"
          x1="215"
          y1="65"
          x2="465"
          y2="280"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f9fbff" />
          <stop offset=".45" stopColor="#d8e2f0" />
          <stop offset="1" stopColor="#7f91ad" />
        </linearGradient>
        <radialGradient id="camera-glass">
          <stop stopColor="#304b6e" />
          <stop offset=".35" stopColor="#0a142b" />
          <stop offset=".65" stopColor="#243f62" />
          <stop offset="1" stopColor="#050b19" />
        </radialGradient>
        <linearGradient id="camera-shine">
          <stop stopColor="#c0daff" stopOpacity=".8" />
          <stop offset="1" stopColor="#b5a0ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="328" cy="184" rx="250" ry="160" fill="url(#camera-aura)" />
      <path d="M321 67 445 105c45 14 55 143 0 156l-124 28V67Z" fill="url(#camera-metal)" />
      <ellipse cx="318" cy="178" rx="112" ry="117" fill="url(#camera-metal)" />
      <ellipse cx="318" cy="178" rx="97" ry="102" fill="#18253b" />
      <ellipse cx="318" cy="178" rx="82" ry="88" fill="#42618c" />
      {Array.from({ length: 22 }, (_, i) => {
        const a = (i / 22) * Math.PI * 2;
        return (
          <circle
            key={i}
            cx={318 + Math.cos(a) * 88}
            cy={178 + Math.sin(a) * 93}
            r="4"
            fill="#91aff2"
            stroke="#3a4268"
            strokeWidth="2"
          />
        );
      })}
      <ellipse cx="318" cy="178" rx="69" ry="75" fill="#080f20" stroke="#667f9b" strokeWidth="2" />
      <ellipse
        cx="318"
        cy="178"
        rx="53"
        ry="60"
        fill="url(#camera-glass)"
        stroke="#374f6f"
        strokeWidth="3"
      />
      <ellipse cx="318" cy="178" rx="28" ry="34" fill="#030817" />
      <path
        d="M290 132c22-15 51-3 65 19"
        stroke="url(#camera-shine)"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <path
        d="M278 205c14 26 42 34 65 22"
        stroke="#7367b1"
        strokeOpacity=".5"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse
        cx="297"
        cy="148"
        rx="13"
        ry="7"
        transform="rotate(-24 297 148)"
        fill="#d6edff"
        fillOpacity=".55"
      />
      <path d="M431 123v109" stroke="#aebed4" strokeWidth="2" />
      <path d="m448 129 18 6" stroke="#5ab1d0" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
