// 외부 아이콘 패키지 없이 쓰는 최소 세트 (stroke 기반, currentColor 상속)
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconGauge = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    <path d="m13.4 10.6 3.6-3.6" />
    <path d="M20.5 16.5a9 9 0 1 0-17 0" />
  </Base>
);

export const IconList = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Base>
);

export const IconPlug = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
    <path d="M12 17v5" />
  </Base>
);

export const IconHeadset = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
    <path d="M4 13h3v6H5.5A1.5 1.5 0 0 1 4 17.5V13Z" />
    <path d="M20 13h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5V13Z" />
  </Base>
);

export const IconPlay = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" />
  </Base>
);

export const IconRefresh = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 11a8 8 0 0 0-13.7-5.6L3 8.5" />
    <path d="M3 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 13.7 5.6L21 15.5" />
    <path d="M21 20v-4.5h-4.5" />
  </Base>
);

export const IconPower = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3v9" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </Base>
);

export const IconSignal = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 18v-3M9 18v-7M14 18v-11M19 18V5" />
  </Base>
);

export const IconClock = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const IconAlert = (p: IconProps) => (
  <Base {...p}>
    <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Base>
);

export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
);

export const IconTrash = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M9 7V4h6v3" />
  </Base>
);

export const IconCopy = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="m4 12.5 5 5L20 6.5" />
  </Base>
);

export const IconPencil = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m14.5 6.5 3 3" />
  </Base>
);

export const IconEye = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.75" />
  </Base>
);

export const IconTag = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 11.7V4a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7Z" />
    <path d="M7.5 7.5h.01" />
  </Base>
);

export const IconArrowDown = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4v15M6 13l6 6 6-6" />
  </Base>
);
