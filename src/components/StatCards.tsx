"use client";

import type { ReactNode } from "react";

import { IconClock, IconHeadset, IconSignal, IconTag } from "@/components/icons";
import { useLbe, useNow } from "@/components/LbeProvider";
import { formatDuration } from "@/lib/format";

type Tone = "accent" | "ok" | "warn" | "muted";

const ICON_TONE: Record<Tone, string> = {
  accent: "border-accent/25 bg-accent/10 text-accent",
  ok: "border-ok/25 bg-ok/10 text-ok",
  warn: "border-warn/25 bg-warn/10 text-warn",
  muted: "border-base-750 bg-base-850 text-base-400",
};

function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "muted",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-base-800 bg-base-880 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium tracking-wide text-base-500">{label}</p>
          <p className="tabular mt-1.5 text-2xl leading-none font-semibold tracking-tight text-base-100">
            {value}
          </p>
          {sub ? <p className="mt-1.5 truncate text-[11px] text-base-500">{sub}</p> : null}
        </div>
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${ICON_TONE[tone]}`}>
          {icon}
        </span>
      </div>
    </div>
  );
}

export function StatCards() {
  const { snapshot } = useLbe();
  const now = useNow();

  const devices = snapshot?.devices ?? [];
  const online = devices.filter((d) => d.status === "online").length;
  const unnamed = devices.filter((d) => d.unnamed).length;
  const latencies = devices.map((d) => d.latencyMs).filter((v): v is number => v !== null);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length)
    : null;

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard
        label="등록 기기"
        value={devices.length}
        sub={snapshot ? `포트 ${snapshot.port} 수신 중` : "연결 대기 중"}
        icon={<IconHeadset className="size-[18px]" />}
        tone="accent"
      />
      <StatCard
        label="온라인"
        value={online}
        sub={
          devices.length > 0
            ? `오프라인 ${devices.length - online}대${
                snapshot && snapshot.pending > 0 ? ` · 등록 대기 ${snapshot.pending}건` : ""
              }`
            : "제어 가능 기기 없음"
        }
        icon={<IconSignal className="size-[18px]" />}
        tone={online > 0 ? "ok" : "muted"}
      />
      <StatCard
        label="미할당 이름"
        value={unnamed}
        sub={unnamed > 0 ? "기기 확인 후 이름을 지정하세요" : "모든 기기에 이름이 있습니다"}
        icon={<IconTag className="size-[18px]" />}
        tone={unnamed > 0 ? "warn" : "muted"}
      />
      <StatCard
        label="평균 응답"
        value={avgLatency === null ? "-" : `${avgLatency}ms`}
        sub={snapshot ? `가동 ${formatDuration(now - snapshot.startedAt)}` : "하트비트 왕복 기준"}
        icon={<IconClock className="size-[18px]" />}
        tone="muted"
      />
    </div>
  );
}
