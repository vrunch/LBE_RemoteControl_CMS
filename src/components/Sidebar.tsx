"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconAlert } from "@/components/icons";
import { useLbe, useNow } from "@/components/LbeProvider";
import { NAV_ITEMS } from "@/components/nav-items";
import { StatusDot } from "@/components/ui";
import { formatDuration } from "@/lib/format";

export function Sidebar() {
  const pathname = usePathname();
  const { snapshot, connected } = useLbe();
  const now = useNow();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-base-800 bg-base-900 lg:flex">
      {/* 브랜드 */}
      <div className="flex items-center gap-3 border-b border-base-800 px-5 py-[17px]">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/15 text-[13px] font-bold tracking-tight text-accent">
          LBE
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-tight font-semibold text-base-100">
            원격 제어 콘솔
          </p>
          <p className="truncate text-[11px] leading-tight text-base-500">Remote Control</p>
        </div>
      </div>

      {/* 내비게이션 */}
      <nav className="flex-1 overflow-y-auto p-3">
        <p className="px-2 pt-1 pb-2 text-[10px] font-semibold tracking-[0.12em] text-base-500 uppercase">
          Menu
        </p>
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`focus-ring group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-100 ${
                    active
                      ? "bg-base-800 text-base-100"
                      : "text-base-400 hover:bg-base-850 hover:text-base-200"
                  }`}
                >
                  {active ? (
                    <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
                  ) : null}
                  <Icon className={`size-[17px] ${active ? "text-accent" : ""}`} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 서버 상태 */}
      <div className="border-t border-base-800 p-3">
        {snapshot?.error ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5">
            <IconAlert className="mt-px size-4 shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-danger">소켓 서버 오류</p>
              <p className="mt-0.5 text-[11px] leading-snug break-words text-danger/80">
                {snapshot.error}
              </p>
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-base-800 bg-base-880 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-base-500">웹소켓 포트</span>
            <span className="font-mono text-[11px] font-medium text-base-200">
              {snapshot ? snapshot.port : "----"}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[11px] text-base-500">가동 시간</span>
            <span className="tabular text-[11px] font-medium text-base-200">
              {snapshot ? formatDuration(now - snapshot.startedAt) : "-"}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-base-800 pt-2">
            <StatusDot tone={connected ? "ok" : "danger"} pulse={connected} />
            <span className="text-[11px] font-medium text-base-300">
              {connected ? "관제 연결됨" : "관제 끊김"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
