"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconArrowDown, IconList, IconSearch, IconTrash } from "@/components/icons";
import { useLbe } from "@/components/LbeProvider";
import { Button, EmptyState, Panel, PanelHeader } from "@/components/ui";
import { formatClock } from "@/lib/format";
import { LOG_LEVELS, LOG_LEVEL_LABEL, type LogEntry, type LogLevel } from "@/lib/protocol";

const LEVEL_STYLE: Record<LogLevel, { chip: string; text: string }> = {
  info: { chip: "border-base-750 bg-base-850 text-base-400", text: "text-base-300" },
  success: { chip: "border-ok/25 bg-ok/10 text-ok", text: "text-base-200" },
  command: { chip: "border-accent/25 bg-accent/10 text-accent", text: "text-base-100" },
  warn: { chip: "border-warn/25 bg-warn/10 text-warn", text: "text-base-200" },
  error: { chip: "border-danger/25 bg-danger/10 text-danger", text: "text-danger/90" },
};

const COMPACT_LIMIT = 40;

export function LogPanel({ variant = "full" }: { variant?: "full" | "compact" }) {
  const { logs, clearLogs } = useLbe();
  const compact = variant === "compact";

  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(LOG_LEVELS));
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (compact) return logs.slice(-COMPACT_LIMIT);

    const q = query.trim().toLowerCase();
    return logs.filter((entry) => {
      if (!levels.has(entry.level)) return false;
      if (!q) return true;
      // 메시지에 표시이름과 uid 뒤 6자리가 함께 찍히므로 둘 다로 검색된다.
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.tag.toLowerCase().includes(q) ||
        (entry.uid ?? "").toLowerCase().includes(q)
      );
    });
  }, [logs, levels, query, compact]);

  // 새 로그가 들어오면 바닥으로 따라 내려간다.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, autoScroll]);

  // 사용자가 위로 스크롤하면 자동 추적을 멈춘다.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const toggleLevel = (level: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <Panel className={compact ? "" : "flex min-h-0 flex-1 flex-col"}>
      <PanelHeader
        title={compact ? "최근 활동" : "이벤트 로그"}
        desc={
          compact
            ? "서버에서 발생한 최신 이벤트"
            : `${filtered.length}건 표시 중 · 최대 ${logs.length}건 보관`
        }
        right={
          compact ? (
            <Link
              href="/logs"
              className="focus-ring rounded-lg border border-base-750 bg-base-850 px-2.5 py-1 text-[11px] font-medium text-base-300 transition-colors hover:bg-base-800 hover:text-base-100"
            >
              전체 보기
            </Link>
          ) : (
            <>
              {!autoScroll ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setAutoScroll(true);
                    const el = scrollRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  }}
                >
                  <IconArrowDown className="size-3.5" />
                  최신으로
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={clearLogs}>
                <IconTrash className="size-3.5" />
                화면 지우기
              </Button>
            </>
          )
        }
      />

      {/* 필터 */}
      {!compact ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-base-800 px-5 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <IconSearch className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-base-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="기기 ID 또는 메시지 검색"
              className="focus-ring h-8 w-full rounded-lg border border-base-800 bg-base-850 pr-3 pl-8 text-[12px] text-base-100 placeholder:text-base-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {LOG_LEVELS.map((level) => {
              const active = levels.has(level);
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => toggleLevel(level)}
                  className={`focus-ring rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? LEVEL_STYLE[level].chip
                      : "border-base-800 bg-transparent text-base-500 hover:text-base-300"
                  }`}
                >
                  {LOG_LEVEL_LABEL[level]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 목록 */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<IconList className="size-8" />}
          title={logs.length === 0 ? "아직 기록된 이벤트가 없습니다" : "조건에 맞는 로그가 없습니다"}
          desc={
            logs.length === 0
              ? "기기가 접속하거나 명령을 보내면 여기에 기록됩니다."
              : "검색어나 레벨 필터를 조정해 보세요."
          }
        />
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={`overflow-y-auto ${compact ? "max-h-[19rem]" : "min-h-0 flex-1"}`}
        >
          <ul className="divide-y divide-base-800/60">
            {filtered.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const style = LEVEL_STYLE[entry.level];

  return (
    <li className="flex items-start gap-3 px-5 py-2 transition-colors hover:bg-base-850/50">
      <span className="tabular mt-0.5 shrink-0 font-mono text-[11px] text-base-500">
        {formatClock(entry.at)}
      </span>
      <span
        className={`mt-px shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${style.chip}`}
      >
        {entry.tag}
      </span>
      <span className={`min-w-0 text-[12px] leading-relaxed break-words ${style.text}`}>
        {entry.message}
      </span>
    </li>
  );
}
