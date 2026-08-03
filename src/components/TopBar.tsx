"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useLbe, useNow } from "@/components/LbeProvider";
import { NAV_ITEMS, navTitle } from "@/components/nav-items";
import { StatusDot } from "@/components/ui";
import { formatClock } from "@/lib/format";

export function TopBar() {
  const pathname = usePathname();
  const { snapshot, connected } = useLbe();
  const now = useNow();

  const current = navTitle(pathname);
  const online = snapshot?.devices.filter((d) => d.status === "online").length ?? 0;

  return (
    <header className="sticky top-0 z-20 border-b border-base-800 bg-base-950/85 backdrop-blur-md">
      <div className="flex h-[57px] items-center justify-between gap-4 px-5 sm:px-7">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] leading-tight font-semibold tracking-tight text-base-100">
            {current.label}
          </h1>
          <p className="hidden truncate text-[11px] leading-tight text-base-500 sm:block">
            {current.desc}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-lg border border-base-800 bg-base-880 px-3 py-1.5 sm:flex">
            <StatusDot tone={online > 0 ? "ok" : "muted"} pulse={online > 0} />
            <span className="tabular text-[12px] font-medium text-base-200">
              기기 {online}
              <span className="text-base-500"> / {snapshot?.devices.length ?? 0}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-base-800 bg-base-880 px-3 py-1.5">
            <StatusDot tone={connected ? "accent" : "danger"} pulse={connected} />
            {/* now 는 하이드레이션 전까지 0 이므로 자리만 잡아 둔다. */}
            <span className="tabular hidden text-[12px] font-medium text-base-300 md:inline">
              {now ? formatClock(now) : "--:--:--"}
            </span>
            <span className="text-[12px] font-medium text-base-300 md:hidden">
              {connected ? "연결됨" : "끊김"}
            </span>
          </div>
        </div>
      </div>

      {/* 모바일 내비게이션 */}
      <nav className="flex gap-1 overflow-x-auto border-t border-base-800 px-3 py-2 lg:hidden">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`focus-ring inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                active
                  ? "border-base-700 bg-base-800 text-base-100"
                  : "border-transparent text-base-400 hover:bg-base-850 hover:text-base-200"
              }`}
            >
              <Icon className={`size-4 ${active ? "text-accent" : ""}`} />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
