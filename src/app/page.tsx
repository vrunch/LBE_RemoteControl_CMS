"use client";

import { BulkControl } from "@/components/BulkControl";
import { DeviceTable } from "@/components/DeviceTable";
import { IconAlert } from "@/components/icons";
import { useLbe } from "@/components/LbeProvider";
import { LogPanel } from "@/components/LogPanel";
import { StatCards } from "@/components/StatCards";

export default function DashboardPage() {
  const { snapshot, connected } = useLbe();

  return (
    <>
      {snapshot?.error ? (
        <Banner
          tone="danger"
          title="웹소켓 서버를 시작하지 못했습니다"
          desc={snapshot.error}
        />
      ) : null}

      {!connected ? (
        <Banner
          tone="warn"
          title="관제 서버와 연결이 끊어졌습니다"
          desc="자동으로 다시 연결을 시도합니다. 계속 끊겨 있다면 Next 서버가 실행 중인지 확인하세요."
        />
      ) : null}

      <StatCards />
      <BulkControl />
      <DeviceTable />
      <LogPanel variant="compact" />
    </>
  );
}

function Banner({
  tone,
  title,
  desc,
}: {
  tone: "danger" | "warn";
  title: string;
  desc: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
        tone === "danger"
          ? "border-danger/25 bg-danger/[0.07]"
          : "border-warn/25 bg-warn/[0.07]"
      }`}
    >
      <IconAlert
        className={`mt-0.5 size-[18px] shrink-0 ${tone === "danger" ? "text-danger" : "text-warn"}`}
      />
      <div className="min-w-0">
        <p
          className={`text-[13px] font-semibold ${tone === "danger" ? "text-danger" : "text-warn"}`}
        >
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed break-words text-base-400">{desc}</p>
      </div>
    </div>
  );
}
