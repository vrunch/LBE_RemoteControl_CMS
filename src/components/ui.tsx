import type { ComponentProps, ReactNode } from "react";

// ============================================================
// 패널 (CMS 카드)
// ============================================================
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-base-800 bg-base-880 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  desc,
  right,
}: {
  title: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-base-800 px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-base-100">{title}</h2>
        {desc ? <p className="mt-0.5 text-xs text-base-400">{desc}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </header>
  );
}

// ============================================================
// 상태 점 / 배지
// ============================================================
type Tone = "ok" | "warn" | "danger" | "accent" | "muted";

const DOT_TONE: Record<Tone, string> = {
  ok: "bg-ok shadow-[0_0_0_3px_rgba(52,211,153,0.16)]",
  warn: "bg-warn shadow-[0_0_0_3px_rgba(245,181,68,0.16)]",
  danger: "bg-danger shadow-[0_0_0_3px_rgba(248,113,113,0.16)]",
  accent: "bg-accent shadow-[0_0_0_3px_rgba(91,140,255,0.16)]",
  muted: "bg-base-500",
};

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${DOT_TONE[tone]} ${pulse ? "animate-breathe" : ""}`}
    />
  );
}

const BADGE_TONE: Record<Tone, string> = {
  ok: "border-ok/25 bg-ok/10 text-ok",
  warn: "border-warn/25 bg-warn/10 text-warn",
  danger: "border-danger/25 bg-danger/10 text-danger",
  accent: "border-accent/25 bg-accent/10 text-accent",
  muted: "border-base-750 bg-base-850 text-base-300",
};

export function Badge({
  tone = "muted",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ============================================================
// 버튼
// ============================================================
type ButtonVariant = "primary" | "ghost" | "positive" | "warning" | "danger";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 hover:border-accent/60",
  ghost: "border-base-750 bg-base-850 text-base-200 hover:bg-base-800 hover:border-base-700",
  positive: "border-ok/30 bg-ok/10 text-ok hover:bg-ok/20 hover:border-ok/50",
  warning: "border-warn/30 bg-warn/10 text-warn hover:bg-warn/20 hover:border-warn/50",
  danger: "border-danger/30 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger/50",
};

const BUTTON_SIZE = {
  sm: "h-7 gap-1.5 px-2.5 text-[11px]",
  md: "h-9 gap-2 px-3.5 text-[13px]",
} as const;

export function Button({
  variant = "ghost",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZE;
}) {
  return (
    <button
      type="button"
      className={`focus-ring inline-flex items-center justify-center rounded-lg border font-medium whitespace-nowrap transition-colors duration-100 select-none disabled:pointer-events-none disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
      {...props}
    />
  );
}

// ============================================================
// 빈 상태
// ============================================================
export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon?: ReactNode;
  title: string;
  desc?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-1 text-base-500">{icon}</div> : null}
      <p className="text-sm font-medium text-base-300">{title}</p>
      {desc ? <p className="max-w-sm text-xs leading-relaxed text-base-500">{desc}</p> : null}
    </div>
  );
}
