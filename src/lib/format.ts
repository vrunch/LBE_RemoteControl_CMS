// 브라우저에서만 렌더되는 시간 표기 헬퍼 (SSR 시점에는 호출되지 않음)

/** 14:03:21 */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 2026-07-30 14:03:21 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${formatClock(ts)}`;
}

/** 경과 시간을 "1시간 23분" 형태로 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}

/** "방금" / "12초 전" / "3분 전" */
export function formatRelative(ts: number | null, now: number): string {
  if (!ts) return "-";

  const diff = Math.max(0, now - ts);
  if (diff < 3000) return "방금";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}초 전`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  return `${Math.floor(hours / 24)}일 전`;
}

/** 지연 시간에 따른 표시 색상 */
export function latencyTone(ms: number | null): "ok" | "warn" | "danger" | "muted" {
  if (ms === null) return "muted";
  if (ms < 80) return "ok";
  if (ms < 250) return "warn";
  return "danger";
}
