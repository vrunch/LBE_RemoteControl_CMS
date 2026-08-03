// ============================================================
// 서버 <-> 클라이언트(Unity) <-> 웹 UI 공용 규격
//
// 이 파일은 브라우저 번들에도 포함되므로 Node 전용 모듈을 import 하지 않는다.
//
// [식별 체계]
//   uid  : 기기 하드웨어 고유값. 절대 변하지 않는 '진짜 식별자'이자 소켓 관리 키.
//   name : 운영자가 읽는 표시이름. 서버의 매핑 테이블(devices.json)이 소유한다.
//          클라이언트가 REGISTER 에 실어 보내는 deviceId 는 참고용일 뿐 신뢰하지 않는다.
//
// COMMANDS 의 code 값은 Unity 쪽 VRRemoteClient.Commands 문자열과
// 반드시 일치해야 한다.
// ============================================================

export type CommandTone = "info" | "positive" | "warning" | "danger";

export const COMMANDS = {
  identify: { code: "IDENTIFY", label: "기기 확인", tone: "info" },
  start: { code: "LAUNCH_APP", label: "앱 실행", tone: "positive" },
  reset: { code: "RESET_GAME", label: "게임 초기화", tone: "warning" },
  quit: { code: "QUIT_APP", label: "앱 종료", tone: "danger" },
} as const satisfies Record<string, { code: string; label: string; tone: CommandTone }>;

export type CommandKey = keyof typeof COMMANDS;

/** UI 버튼 노출 순서 */
export const COMMAND_KEYS = ["identify", "start", "reset", "quit"] as const satisfies readonly CommandKey[];

/**
 * 이름 변경 시 서버가 기기로 내려보내는 내부 명령.
 * 운영자가 직접 고르는 명령이 아니므로 COMMANDS 에 넣지 않는다.
 */
export const SET_NAME_CODE = "SET_NAME";

export function isCommandKey(value: unknown): value is CommandKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COMMANDS, value);
}

/** 명령 코드(LAUNCH_APP 등)를 사람이 읽는 라벨로 */
export function commandLabelByCode(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === SET_NAME_CODE) return "이름 변경";
  const found = Object.values(COMMANDS).find((c) => c.code === code);
  return found ? found.label : code;
}

// ------------------------------------------------------------
// 이름 규칙 (Unity 쪽 SanitizeName 과 동일하게 맞춘다)
// ------------------------------------------------------------
export const NAME_MAX_LENGTH = 32;
export const UNNAMED_PREFIX = "UNNAMED_";

const NAME_CHARS = /^[A-Za-z0-9_-]+$/;

/** 허용되지 않는 문자를 걸러내고 길이를 자른다. */
export function sanitizeName(value: unknown): string {
  let result = "";
  for (const ch of String(value ?? "")) {
    if (/[A-Za-z0-9_-]/.test(ch)) result += ch;
  }
  return result.slice(0, NAME_MAX_LENGTH);
}

/**
 * uid 를 줄여 표기할 때 쓰는 뒷자리 수.
 * Unity 쪽 VRRemoteClient.Last6 과 반드시 같아야 한다. (여기만 바꾸면 서버 전체에 반영됨)
 */
export const UID_SUFFIX_LENGTH = 6;

/** uid 뒤 6자리 대문자 (Unity 쪽 Last6 과 동일) */
export function uidSuffix(uid: unknown): string {
  const upper = String(uid ?? "").toUpperCase();
  if (!upper) return "";
  return upper.length > UID_SUFFIX_LENGTH ? upper.slice(-UID_SUFFIX_LENGTH) : upper;
}

/** 매핑 테이블에 없는 기기에 자동으로 붙이는 이름 */
export function unnamedFor(uid: string): string {
  return `${UNNAMED_PREFIX}${uidSuffix(uid)}`;
}

export function isUnnamed(name: string): boolean {
  return name.startsWith(UNNAMED_PREFIX);
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** 운영자가 입력한 이름을 검증한다. (조용히 고치지 않고 사유를 돌려준다) */
export function validateName(raw: unknown): NameCheck {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "이름을 입력하세요." };
  if (value.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `이름은 최대 ${NAME_MAX_LENGTH}자입니다.` };
  }
  if (!NAME_CHARS.test(value)) {
    return { ok: false, error: "영문, 숫자, _, - 만 사용할 수 있습니다." };
  }
  return { ok: true, name: value };
}

// ------------------------------------------------------------
// 기기 상태
// ------------------------------------------------------------
export type DeviceStatus = "online" | "offline";

export type DeviceView = {
  /** 하드웨어 고유값 (소켓 관리 키) */
  uid: string;
  /** 매핑 테이블이 확정한 표시이름 */
  name: string;
  /** 자동 부여된 미할당 이름인지 */
  unnamed: boolean;
  /** 기기 모델명 (REGISTER 시 수신) */
  model: string | null;
  status: DeviceStatus;

  ip: string | null;
  /** epoch ms. 오프라인이면 null */
  connectedAt: number | null;
  lastSeenAt: number | null;

  /** 마지막으로 보낸 명령 코드 */
  lastCommand: string | null;
  lastCommandAt: number | null;
  /** 클라이언트가 회신한 ACK 상태 문자열 */
  lastAck: string | null;
  lastAckAt: number | null;
  /** ping/pong 왕복 지연 (ms) */
  latencyMs: number | null;
};

export type ServerSnapshot = {
  port: number;
  /** 허브 기동 시각 (epoch ms) */
  startedAt: number;
  /** 매핑 테이블 전체 (접속 중 + 등록만 되어 있는 기기) */
  devices: DeviceView[];
  /** 접속했지만 아직 REGISTER 하지 않은 소켓 수 */
  pending: number;
  /** 매핑 테이블 파일 경로 */
  registryPath: string;
  /** 포트 충돌 등 기동 실패 사유 */
  error: string | null;
};

// ------------------------------------------------------------
// 로그
// ------------------------------------------------------------
export type LogLevel = "info" | "success" | "warn" | "error" | "command";

export const LOG_LEVELS = ["info", "success", "command", "warn", "error"] as const;

export const LOG_LEVEL_LABEL: Record<LogLevel, string> = {
  info: "정보",
  success: "성공",
  command: "명령",
  warn: "경고",
  error: "오류",
};

export type LogEntry = {
  id: number;
  at: number;
  level: LogLevel;
  /** 대괄호로 감싸 표기되는 짧은 분류 (예: 등록 완료) */
  tag: string;
  message: string;
  /** 관련 기기의 uid */
  uid: string | null;
};

// ------------------------------------------------------------
// SSE 스트림 메시지
// ------------------------------------------------------------
export type StreamMessage =
  | { type: "init"; snapshot: ServerSnapshot; logs: LogEntry[] }
  | { type: "snapshot"; snapshot: ServerSnapshot }
  | { type: "log"; entry: LogEntry };

// ------------------------------------------------------------
// 명령 API
// ------------------------------------------------------------

/** targets 는 표시이름 배열이거나 "all". 서버가 매핑 테이블에서 uid 로 역해석한다. */
export type CommandRequest = {
  command: CommandKey;
  targets: string[] | "all";
};

export type CommandResult = {
  ok: boolean;
  command: CommandKey;
  label: string;
  /** 전송에 성공한 기기 표시이름 */
  sent: string[];
  /** 오프라인이거나 이름을 찾지 못한 대상 */
  failed: string[];
  error?: string;
};

/** target 은 현재 표시이름 또는 uid */
export type RenameRequest = { target: string; name: string };

export type RenameResult = {
  ok: boolean;
  uid?: string;
  from?: string;
  to?: string;
  /** 접속 중이어서 SET_NAME 을 실제로 내려보냈는지 */
  notified?: boolean;
  error?: string;
};

/** 매핑 테이블에서 항목을 제거한다. (오프라인 기기만) */
export type ForgetRequest = { target: string };

export type ForgetResult = { ok: boolean; uid?: string; name?: string; error?: string };

/** UI 로그 버퍼 상한 */
export const LOG_LIMIT = 500;
