import fs from "node:fs";
import path from "node:path";

import { sanitizeName, unnamedFor, type DeviceView } from "@/lib/protocol";

// ============================================================
// uid -> 표시이름 매핑 테이블 (devices.json 영속화)
//
// 이 테이블이 기기 이름의 유일한 원본이다. 클라이언트가 로컬에 캐시한
// 이름은 참고용일 뿐이며, 어떤 경우에도 이 테이블을 덮어쓰지 못한다.
// ============================================================

export type RegistryEntry = {
  uid: string;
  name: string;
  model: string | null;
  /** 이름/모델이 마지막으로 갱신된 시각 */
  updatedAt: number;
  /** 마지막으로 접속했던 시각 */
  lastConnectedAt: number | null;
};

type FileShape = {
  version: number;
  devices: RegistryEntry[];
};

const FILE_VERSION = 1;

export function resolveRegistryPath(): string {
  const custom = process.env.LBE_DEVICES_FILE;
  if (custom && custom.trim()) return path.resolve(custom.trim());
  return path.join(process.cwd(), "devices.json");
}

export type LoadResult = {
  entries: Map<string, RegistryEntry>;
  /** 사용자에게 알려야 할 경고 (파일 없음 / 손상 등) */
  warning: string | null;
  /** 정상적으로 읽어 들였는지 */
  loaded: boolean;
};

/**
 * devices.json 을 읽는다.
 * 파일이 없거나 깨져 있어도 절대 예외를 던지지 않고 빈 테이블로 시작한다.
 */
export function loadRegistry(filePath: string): LoadResult {
  const empty = new Map<string, RegistryEntry>();

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { entries: empty, warning: null, loaded: false };
    }
    return {
      entries: empty,
      warning: `매핑 테이블을 읽지 못해 빈 목록으로 시작합니다: ${(error as Error).message}`,
      loaded: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      entries: empty,
      warning: `${path.basename(filePath)} 형식이 올바르지 않아 빈 목록으로 시작합니다. (기존 파일은 덮어쓰기 전까지 보존됩니다)`,
      loaded: false,
    };
  }

  // { version, devices: [...] } 와 { uid: name } 단순 형태를 모두 받아들인다.
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as FileShape)?.devices)
      ? (parsed as FileShape).devices
      : [];

  if (rows.length === 0 && !Array.isArray(parsed) && parsed && typeof parsed === "object") {
    for (const [uid, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name !== "string") continue;
      const entry = normalizeEntry({ uid, name });
      if (entry) empty.set(entry.uid, entry);
    }
    if (empty.size > 0) return { entries: empty, warning: null, loaded: true };
  }

  let skipped = 0;
  for (const row of rows) {
    const entry = normalizeEntry(row);
    if (entry) empty.set(entry.uid, entry);
    else skipped += 1;
  }

  return {
    entries: empty,
    warning: skipped > 0 ? `매핑 테이블에서 형식이 잘못된 항목 ${skipped}건을 건너뛰었습니다.` : null,
    loaded: true,
  };
}

function normalizeEntry(row: unknown): RegistryEntry | null {
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  const uid = sanitizeName(record.uid);
  if (!uid) return null;

  // 이름이 비었거나 규칙에 어긋나면 미할당 이름으로 되돌린다.
  const name = sanitizeName(record.name) || unnamedFor(uid);
  const model = typeof record.model === "string" && record.model.trim() ? record.model.trim() : null;

  const updatedAt = Number(record.updatedAt);
  const lastConnectedAt = Number(record.lastConnectedAt);

  return {
    uid,
    name,
    model,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    lastConnectedAt: Number.isFinite(lastConnectedAt) && lastConnectedAt > 0 ? lastConnectedAt : null,
  };
}

/**
 * 매핑 테이블을 저장한다.
 * 임시 파일에 쓴 뒤 교체해 중간에 죽어도 원본이 깨지지 않게 한다.
 */
export function saveRegistry(filePath: string, entries: Map<string, RegistryEntry>): string | null {
  const payload: FileShape = {
    version: FILE_VERSION,
    devices: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const tmp = `${filePath}.tmp`;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, filePath);
    return null;
  } catch {
    // rename 이 막히는 환경(파일 잠금 등)에서는 직접 쓰기로 물러선다.
    try {
      fs.writeFileSync(filePath, text, "utf8");
      return null;
    } catch (error) {
      return `매핑 테이블 저장 실패: ${(error as Error).message}`;
    }
  }
}

/** 매핑 테이블 항목을 오프라인 상태의 DeviceView 로 변환 */
export function toOfflineView(entry: RegistryEntry): DeviceView {
  return {
    uid: entry.uid,
    name: entry.name,
    unnamed: entry.name.startsWith("UNNAMED_"),
    model: entry.model,
    status: "offline",
    ip: null,
    connectedAt: null,
    lastSeenAt: entry.lastConnectedAt,
    lastCommand: null,
    lastCommandAt: null,
    lastAck: null,
    lastAckAt: null,
    latencyMs: null,
  };
}
