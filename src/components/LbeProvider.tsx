"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  COMMANDS,
  LOG_LIMIT,
  type CommandKey,
  type CommandResult,
  type ForgetResult,
  type LogEntry,
  type RenameResult,
  type ServerSnapshot,
  type StreamMessage,
  type TeamStartResult,
} from "@/lib/protocol";

// ============================================================
// 토스트
// ============================================================
export type Toast = {
  id: number;
  tone: "ok" | "warn" | "danger";
  title: string;
  desc?: string;
};

// ============================================================
// 컨텍스트
// ============================================================
type LbeContextValue = {
  /** SSE 연결 상태 (대시보드 <-> Next 서버) */
  connected: boolean;
  snapshot: ServerSnapshot | null;
  logs: LogEntry[];
  /** 명령 전송 중 여부 */
  sending: boolean;
  /** targets 는 표시이름 배열 또는 "all" */
  sendCommand: (command: CommandKey, targets: string[] | "all") => Promise<CommandResult | null>;
  /** 팀 세션 시작 (기존 QR 스캔 대체). targets 는 표시이름/uid 배열 또는 "all" */
  startTeam: (teamId: number, teamCount: number, targets: string[] | "all") => Promise<TeamStartResult | null>;
  /** target 은 현재 표시이름 또는 uid */
  renameDevice: (target: string, name: string) => Promise<RenameResult>;
  forgetDevice: (target: string) => Promise<ForgetResult>;
  clearLogs: () => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
};

const LbeContext = createContext<LbeContextValue | null>(null);

export function useLbe(): LbeContextValue {
  const ctx = useContext(LbeContext);
  if (!ctx) throw new Error("useLbe 는 <LbeProvider> 안에서만 사용할 수 있습니다.");
  return ctx;
}

// ============================================================
// 공용 시계
//
// 서버 렌더 결과와 하이드레이션 첫 렌더가 반드시 같아야 하므로,
// 서버 쪽 스냅샷은 0 으로 고정하고 브라우저가 붙은 뒤부터 실제 시각을 흘린다.
// (useState(() => Date.now()) 로 두면 서버 시각과 브라우저 시각이 달라
//  hydration mismatch 가 난다)
//
// 구독자가 몇 개든 setInterval 은 하나만 돈다.
// ============================================================
const CLOCK_INTERVAL = 1000;

let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(onStoreChange: () => void): () => void {
  clockListeners.add(onStoreChange);

  if (!clockTimer) {
    // 구독이 시작되는 시점(= 하이드레이션 이후)에 첫 값을 채운다.
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((listener) => listener());
    }, CLOCK_INTERVAL);
  }

  return () => {
    clockListeners.delete(onStoreChange);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

const getClockSnapshot = () => clockNow;
const getClockServerSnapshot = () => 0;

/**
 * 상대 시간 표기를 위해 1초마다 갱신되는 현재 시각.
 *
 * 서버 렌더와 하이드레이션 첫 렌더에서는 **0** 을 돌려준다.
 * 시각을 그대로 화면에 찍는 곳은 `now` 가 0 인 경우를 반드시 처리해야 한다.
 * (`snapshot` 이 있어야 그려지는 곳은 SSE 도착 이후라 항상 실제 값이다)
 */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, getClockSnapshot, getClockServerSnapshot);
}

// ============================================================
// 프로바이더
// ============================================================
export function LbeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<ServerSnapshot | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toastSeq = useRef(0);
  /** 화면 지우기 이후로는 그보다 오래된 로그를 다시 그리지 않는다. */
  const logFloor = useRef(0);

  // ---------- SSE 구독 ----------
  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.onopen = () => setConnected(true);

    source.onerror = () => {
      // EventSource 는 스스로 재연결하므로 상태만 내려둔다.
      setConnected(false);
    };

    source.onmessage = (event) => {
      let message: StreamMessage;
      try {
        message = JSON.parse(event.data) as StreamMessage;
      } catch {
        return;
      }

      setConnected(true);

      switch (message.type) {
        case "init":
          setSnapshot(message.snapshot);
          setLogs(message.logs.filter((l) => l.id > logFloor.current));
          break;

        case "snapshot":
          setSnapshot(message.snapshot);
          break;

        case "log":
          setLogs((prev) => {
            if (message.entry.id <= logFloor.current) return prev;
            const next = [...prev, message.entry];
            return next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next;
          });
          break;
      }
    };

    return () => source.close();
  }, []);

  // ---------- 토스트 ----------
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++toastSeq.current;
      setToasts((prev) => [...prev, { ...toast, id }]);
      setTimeout(() => dismissToast(id), 4000);
    },
    [dismissToast],
  );

  // ---------- 명령 전송 ----------
  const sendCommand = useCallback(
    async (command: CommandKey, targets: string[] | "all"): Promise<CommandResult | null> => {
      setSending(true);
      try {
        const response = await fetch("/api/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, targets }),
        });

        const result = (await response.json()) as CommandResult & { error?: string };

        if (!response.ok || !result.ok) {
          pushToast({
            tone: result.sent?.length ? "warn" : "danger",
            title: `${COMMANDS[command].label} 전송 실패`,
            desc:
              result.error ??
              (result.failed?.length ? `실패: ${result.failed.join(", ")}` : "요청을 처리하지 못했습니다."),
          });
        } else {
          pushToast({
            tone: "ok",
            title: `${result.label} 전송 완료`,
            desc:
              targets === "all"
                ? `접속된 ${result.sent.length}대에 일괄 전송했습니다.`
                : `${result.sent.join(", ")}`,
          });
        }

        return result;
      } catch {
        pushToast({
          tone: "danger",
          title: "서버에 연결할 수 없습니다",
          desc: "Next 서버가 실행 중인지 확인하세요.",
        });
        return null;
      } finally {
        setSending(false);
      }
    },
    [pushToast],
  );

  // ---------- 팀 세션 시작 (QR 스캔 대체) ----------
  const startTeam = useCallback(
    async (teamId: number, teamCount: number, targets: string[] | "all"): Promise<TeamStartResult | null> => {
      setSending(true);
      try {
        const response = await fetch("/api/team", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId, teamCount, targets }),
        });

        const result = (await response.json()) as TeamStartResult & { error?: string };

        if (!response.ok || !result.ok) {
          pushToast({
            tone: result.sent?.length ? "warn" : "danger",
            title: "팀 세션 시작 전송 실패",
            desc:
              result.error ??
              (result.failed?.length ? `실패: ${result.failed.join(", ")}` : "요청을 처리하지 못했습니다."),
          });
        } else {
          pushToast({
            tone: "ok",
            title: `${result.label} 전송 완료`,
            desc: `${result.sent.join(", ")} · 이미 세션 중인 기기는 FAIL 로 응답합니다.`,
          });
        }

        return result;
      } catch {
        pushToast({
          tone: "danger",
          title: "서버에 연결할 수 없습니다",
          desc: "Next 서버가 실행 중인지 확인하세요.",
        });
        return null;
      } finally {
        setSending(false);
      }
    },
    [pushToast],
  );

  // ---------- 이름 변경 ----------
  const renameDevice = useCallback(
    async (target: string, name: string): Promise<RenameResult> => {
      try {
        const response = await fetch("/api/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, name }),
        });
        const result = (await response.json()) as RenameResult;

        if (result.ok) {
          pushToast({
            tone: "ok",
            title: "이름을 변경했습니다",
            desc: `${result.from} → ${result.to}${result.notified ? "" : " (오프라인 · 접속 시 기기에 반영)"}`,
          });
        }
        return result;
      } catch {
        return { ok: false, error: "서버에 연결할 수 없습니다." };
      }
    },
    [pushToast],
  );

  // ---------- 목록에서 제거 ----------
  const forgetDevice = useCallback(
    async (target: string): Promise<ForgetResult> => {
      try {
        const response = await fetch("/api/forget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target }),
        });
        const result = (await response.json()) as ForgetResult;

        pushToast(
          result.ok
            ? { tone: "ok", title: "목록에서 제거했습니다", desc: result.name }
            : { tone: "danger", title: "제거 실패", desc: result.error },
        );
        return result;
      } catch {
        pushToast({ tone: "danger", title: "서버에 연결할 수 없습니다" });
        return { ok: false, error: "서버에 연결할 수 없습니다." };
      }
    },
    [pushToast],
  );

  // ---------- 로그 비우기 ----------
  const clearLogs = useCallback(() => {
    setLogs((prev) => {
      if (prev.length > 0) logFloor.current = prev[prev.length - 1].id;
      return [];
    });
  }, []);

  const value = useMemo<LbeContextValue>(
    () => ({
      connected,
      snapshot,
      logs,
      sending,
      sendCommand,
      startTeam,
      renameDevice,
      forgetDevice,
      clearLogs,
      toasts,
      dismissToast,
    }),
    [
      connected,
      snapshot,
      logs,
      sending,
      sendCommand,
      startTeam,
      renameDevice,
      forgetDevice,
      clearLogs,
      toasts,
      dismissToast,
    ],
  );

  return <LbeContext.Provider value={value}>{children}</LbeContext.Provider>;
}
