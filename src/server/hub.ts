import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  COMMANDS,
  LOG_LIMIT,
  SET_NAME_CODE,
  isUnnamed,
  uidSuffix,
  sanitizeName,
  unnamedFor,
  validateName,
  type ChargingState,
  type CommandKey,
  type CommandResult,
  type DeviceView,
  type ForgetResult,
  type LogEntry,
  type LogLevel,
  type RenameResult,
  type ServerSnapshot,
  type StreamMessage,
} from "@/lib/protocol";
import {
  loadRegistry,
  resolveRegistryPath,
  saveRegistry,
  toOfflineView,
  type RegistryEntry,
} from "@/server/registry";

// ============================================================
// 설정
// ============================================================
const PORT = Number(process.env.LBE_WS_PORT ?? 7485);
const HEARTBEAT_INTERVAL = 10_000; // 10초마다 생존 확인 (죽은 소켓 청소용)
const SNAPSHOT_DEBOUNCE = 60; // 상태 변경이 몰릴 때 브로드캐스트 합치기

// ============================================================
// 내부 자료구조
// ============================================================

/** 접속 중인 소켓. 키는 항상 uid 다. */
type Connection = {
  uid: string;
  socket: WebSocket;
  ip: string;
  connectedAt: number;
  lastSeenAt: number;
  lastCommand: string | null;
  lastCommandAt: number | null;
  lastAck: string | null;
  lastAckAt: number | null;
  latencyMs: number | null;
  /** 배터리 잔량 % (STATUS 보고 기반, 없으면 null) */
  battery: number | null;
  batteryCharging: ChargingState | null;
  batteryAt: number | null;
};

type SocketMeta = {
  ip: string;
  isAlive: boolean;
  /** REGISTER 를 마치기 전에는 null */
  uid: string | null;
  connectedAt: number;
  pingSentAt: number | null;
};

type Listener = (message: StreamMessage) => void;

function normalizeIp(req: IncomingMessage): string {
  // 깔끔한 IPv4 출력을 위해 IPv6 매핑 접두사를 제거
  return String(req.socket.remoteAddress || "unknown").replace("::ffff:", "");
}

function safeSend(socket: WebSocket, payload: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 허브 본체
// ============================================================
class LbeHub {
  readonly port = PORT;
  readonly startedAt = Date.now();
  readonly registryPath = resolveRegistryPath();

  private wss: WebSocketServer | null = null;
  private startupError: string | null = null;

  /** uid -> 매핑 테이블 항목 (오프라인 기기 포함) */
  private registry = new Map<string, RegistryEntry>();
  /** uid -> 접속 중인 소켓 */
  private connections = new Map<string, Connection>();
  private meta = new Map<WebSocket, SocketMeta>();

  private logs: LogEntry[] = [];
  private logSeq = 0;

  private emitter = new EventEmitter();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // SSE 구독자가 여러 명 붙어도 경고가 뜨지 않도록
    this.emitter.setMaxListeners(0);
    this.loadTable();
    this.boot();
  }

  // ----------------------------------------------------------
  // 매핑 테이블
  // ----------------------------------------------------------
  private loadTable() {
    const result = loadRegistry(this.registryPath);
    this.registry = result.entries;

    const fileName = path.basename(this.registryPath);
    if (result.warning) {
      this.pushLog("warn", "매핑 테이블", result.warning);
    } else if (!result.loaded) {
      this.pushLog("info", "매핑 테이블", `${fileName} 이 없어 빈 목록으로 시작합니다.`);
    } else {
      this.pushLog("info", "매핑 테이블", `${fileName} 에서 기기 ${this.registry.size}대를 불러왔습니다.`);
    }
  }

  private persist() {
    const error = saveRegistry(this.registryPath, this.registry);
    if (error) this.pushLog("error", "매핑 테이블", error);
  }

  /** 표시이름 또는 uid 로 매핑 테이블 항목을 찾는다. */
  private resolve(target: string): RegistryEntry | null {
    const key = String(target ?? "").trim();
    if (!key) return null;

    const byUid = this.registry.get(key);
    if (byUid) return byUid;

    const lowered = key.toLowerCase();
    for (const entry of this.registry.values()) {
      if (entry.name.toLowerCase() === lowered) return entry;
    }
    return null;
  }

  /** 이미 쓰이고 있는 이름인지 (대소문자 무시). except 는 검사에서 제외할 uid */
  private isNameTaken(name: string, except?: string): boolean {
    const lowered = name.toLowerCase();
    for (const entry of this.registry.values()) {
      if (entry.uid === except) continue;
      if (entry.name.toLowerCase() === lowered) return true;
    }
    return false;
  }

  /** 미할당 기기용 자동 이름. 뒤 6자리가 겹치면 접미사를 붙여 유일하게 만든다. */
  private nextUnnamed(uid: string): string {
    const base = unnamedFor(uid);
    if (!this.isNameTaken(base)) return base;

    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base}-${i}`;
      if (!this.isNameTaken(candidate)) return candidate;
    }
    return `${base}-${uidSuffix(`${uid}${Date.now()}`)}`;
  }

  // ----------------------------------------------------------
  // 기동
  // ----------------------------------------------------------
  private boot() {
    let wss: WebSocketServer;
    try {
      wss = new WebSocketServer({ port: PORT });
    } catch (error) {
      this.fail(error);
      return;
    }
    this.wss = wss;

    wss.on("listening", () => {
      this.pushLog("success", "서버 시작", `LBE 원격 제어 서버가 ${PORT} 포트에서 대기 중입니다.`);
    });

    wss.on("error", (error: Error) => {
      // 대부분 EADDRINUSE (레거시 server.js 가 이미 떠 있는 경우)
      this.fail(error);
    });

    wss.on("connection", (socket, req) => this.handleConnection(socket, req));

    // 하트비트: Wi-Fi가 갑자기 끊긴 HMD는 close 이벤트가 오지 않아 목록에 남는다.
    this.heartbeat = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL);
    this.heartbeat.unref?.();
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = message.includes("EADDRINUSE")
      ? `${PORT} 포트가 이미 사용 중입니다. 기존 콘솔 서버(node server.js)가 실행 중인지 확인하세요.`
      : message;

    // 같은 오류가 반복 발생해도 로그를 도배하지 않도록
    if (this.startupError === detail) return;
    this.startupError = detail;
    this.pushLog("error", "서버 오류", detail);
    this.scheduleSnapshot();
  }

  // ----------------------------------------------------------
  // 소켓 수명 주기
  // ----------------------------------------------------------
  private handleConnection(socket: WebSocket, req: IncomingMessage) {
    const ip = normalizeIp(req);
    this.meta.set(socket, {
      ip,
      isAlive: true,
      uid: null,
      connectedAt: Date.now(),
      pingSentAt: null,
    });

    this.pushLog("info", "연결됨", `새로운 기기가 접속했습니다. (IP: ${ip})`);
    this.scheduleSnapshot();

    socket.on("pong", () => this.handlePong(socket));
    socket.on("message", (raw) => this.handleMessage(socket, raw));

    socket.on("error", (error: Error) => {
      // 핸들러가 없으면 프로세스 전체가 죽으므로 반드시 필요
      const meta = this.meta.get(socket);
      const who = meta?.uid ? this.describe(meta.uid) : (meta?.ip ?? "unknown");
      this.pushLog("error", "소켓 오류", `${who}: ${error.message}`, meta?.uid);
    });

    socket.on("close", () => this.handleClose(socket));
  }

  private handlePong(socket: WebSocket) {
    const meta = this.meta.get(socket);
    if (!meta) return;

    meta.isAlive = true;
    const now = Date.now();
    const latency = meta.pingSentAt ? now - meta.pingSentAt : null;
    meta.pingSentAt = null;

    const connection = meta.uid ? this.connections.get(meta.uid) : undefined;
    if (connection && connection.socket === socket) {
      connection.lastSeenAt = now;
      if (latency !== null) connection.latencyMs = latency;
    }
    this.scheduleSnapshot();
  }

  private handleMessage(socket: WebSocket, raw: RawData) {
    const meta = this.meta.get(socket);
    if (!meta) return;

    let data: Record<string, unknown>;
    try {
      // ws v8+ 에서 raw 는 Buffer 이므로 문자열로 변환 후 파싱
      const parsed: unknown = JSON.parse(raw.toString());
      if (!parsed || typeof parsed !== "object") return;
      data = parsed as Record<string, unknown>;
    } catch {
      this.pushLog("warn", "무시됨", `JSON이 아닌 데이터를 수신했습니다. (IP: ${meta.ip})`);
      return;
    }

    switch (data.type) {
      case "REGISTER":
        this.handleRegister(socket, meta, data);
        break;

      case "ACK":
        this.handleAck(socket, meta, data);
        break;

      // --- 기기의 상태(배터리) 보고 ---
      // 기기가 배터리 '변화 시'와 주기(기본 60초) 안전망으로만 보내므로 부하가 거의 없다.
      // 로그를 남기지 않고 스냅샷만 갱신해 로그 창이 도배되는 것을 막는다. (저전력 경고는 예외)
      case "STATUS":
        this.handleStatus(socket, meta, data);
        break;

      // --- 애플리케이션 레벨 핑 ---
      case "PING":
        safeSend(socket, { type: "PONG" });
        break;

      default:
        this.pushLog(
          "warn",
          "알 수 없는 타입",
          `처리할 수 없는 메시지 타입입니다: ${JSON.stringify(data.type ?? null)} (${meta.uid ? this.describe(meta.uid) : `IP: ${meta.ip}`})`,
          meta.uid,
        );
        break;
    }
  }

  /**
   * 등록 패킷.
   * uid 가 유일한 기준이며, 클라이언트가 보낸 deviceId 는 참고 로그로만 남긴다.
   */
  private handleRegister(socket: WebSocket, meta: SocketMeta, data: Record<string, unknown>) {
    const uid = sanitizeName(data.uid);
    if (!uid) {
      this.pushLog("warn", "등록 실패", `uid가 비어 있습니다. (IP: ${meta.ip})`);
      return;
    }

    const model = typeof data.model === "string" && data.model.trim() ? data.model.trim() : null;
    const clientLabel = sanitizeName(data.deviceId);
    const now = Date.now();

    let entry = this.registry.get(uid);
    let changed = false;

    if (!entry) {
      // 처음 보는 기기 -> 미할당 이름으로 자동 등록
      entry = {
        uid,
        name: this.nextUnnamed(uid),
        model,
        updatedAt: now,
        lastConnectedAt: now,
      };
      this.registry.set(uid, entry);
      changed = true;

      this.pushLog(
        "success",
        "신규 등록",
        `처음 보는 기기입니다. uid ...${uidSuffix(uid)} 에 이름 [${entry.name}] 을(를) 자동 부여했습니다.`,
        uid,
      );
    } else {
      if (model && entry.model !== model) {
        entry.model = model;
        changed = true;
      }
      entry.lastConnectedAt = now;
      changed = true;
    }

    if (changed) {
      entry.updatedAt = now;
      this.persist();
    }

    // 클라이언트 캐시가 서버 이름과 다르면 알려만 준다. (테이블은 절대 덮어쓰지 않음)
    if (clientLabel && clientLabel !== entry.name) {
      this.pushLog(
        "info",
        "이름 동기화",
        `기기가 보낸 캐시 이름 [${clientLabel}] 대신 매핑 테이블의 [${entry.name}] 을(를) 적용합니다.`,
        uid,
      );
    }

    // 같은 uid 로 새 소켓이 붙으면 이전 소켓을 정리한다.
    const previous = this.connections.get(uid);
    if (previous && previous.socket !== socket) {
      this.pushLog("warn", "중복 감지", `${this.describe(uid)} 의 이전 연결을 끊습니다.`, uid);
      try {
        previous.socket.close(4000, "replaced by new connection");
      } catch {
        /* noop */
      }
    }

    meta.uid = uid;
    this.connections.set(uid, {
      uid,
      socket,
      ip: meta.ip,
      connectedAt: meta.connectedAt,
      lastSeenAt: now,
      // 재접속이면 직전 이력을 이어서 보여준다.
      lastCommand: previous?.lastCommand ?? null,
      lastCommandAt: previous?.lastCommandAt ?? null,
      lastAck: previous?.lastAck ?? null,
      lastAckAt: previous?.lastAckAt ?? null,
      latencyMs: null,
      battery: previous?.battery ?? null,
      batteryCharging: previous?.batteryCharging ?? null,
      batteryAt: previous?.batteryAt ?? null,
    });

    this.pushLog(
      "success",
      "등록 완료",
      `IP: ${meta.ip} 기기가 ${this.describe(uid)}${model ? ` / ${model}` : ""} (으)로 등록되었습니다.`,
      uid,
    );

    // 서버가 확정한 이름을 내려보낸다. 클라이언트는 이 값을 로컬에 캐시한다.
    safeSend(socket, { type: "REGISTERED", uid, deviceId: entry.name });
    this.scheduleSnapshot();
  }

  private handleAck(socket: WebSocket, meta: SocketMeta, data: Record<string, unknown>) {
    const command = String(data.command ?? "");
    const status = String(data.status ?? "OK");
    const now = Date.now();

    // uid 는 패킷에 실려 오지만, 소켓에 등록된 uid 를 우선한다.
    const uid = meta.uid ?? (sanitizeName(data.uid) || null);

    const connection = uid ? this.connections.get(uid) : undefined;
    if (connection && connection.socket === socket) {
      connection.lastAck = status;
      connection.lastAckAt = now;
      connection.lastSeenAt = now;
    }

    const ok = status.toUpperCase() === "OK";
    this.pushLog(
      ok ? "success" : "warn",
      "응답",
      `${uid ? this.describe(uid) : `IP: ${meta.ip}`} ${command} -> ${status}`,
      uid,
    );
    this.scheduleSnapshot();
  }

  /**
   * 기기의 상태(배터리) 보고 패킷.
   * { type: "STATUS", uid, battery: 0~100(-1 은 미확인), charging: "charging"|... }
   */
  private handleStatus(socket: WebSocket, meta: SocketMeta, data: Record<string, unknown>) {
    const uid = meta.uid ?? (sanitizeName(data.uid) || null);
    if (!uid) return;

    const connection = this.connections.get(uid);
    if (!connection || connection.socket !== socket) return;

    const now = Date.now();

    const rawBattery = Number(data.battery);
    const battery =
      Number.isFinite(rawBattery) && rawBattery >= 0
        ? Math.min(100, Math.max(0, Math.round(rawBattery)))
        : null;

    const CHARGING_STATES: ChargingState[] = ["charging", "discharging", "not_charging", "full", "unknown"];
    const charging = CHARGING_STATES.includes(data.charging as ChargingState)
      ? (data.charging as ChargingState)
      : null;

    // 20% 이하로 '떨어지는 순간'에만 경고 로그 1회 (도배 방지)
    const LOW_BATTERY = 20;
    const wasLow = connection.battery !== null && connection.battery <= LOW_BATTERY;
    const isLow = battery !== null && battery <= LOW_BATTERY && charging !== "charging";
    if (isLow && !wasLow) {
      this.pushLog("warn", "배터리 부족", `${this.describe(uid)} 배터리가 ${battery}% 입니다. 충전이 필요합니다.`, uid);
    }

    connection.battery = battery;
    connection.batteryCharging = charging;
    connection.batteryAt = now;
    connection.lastSeenAt = now;

    this.scheduleSnapshot();
  }

  private handleClose(socket: WebSocket) {
    const meta = this.meta.get(socket);
    this.meta.delete(socket);
    if (!meta) return;

    const { uid, ip } = meta;

    // 중요: 같은 uid 로 새 소켓이 이미 등록되었을 수 있으므로
    // "내가 등록한 소켓이 맞을 때만" 접속 목록에서 삭제한다.
    if (uid && this.connections.get(uid)?.socket === socket) {
      this.connections.delete(uid);
      this.pushLog("warn", "연결 해제", `${this.describe(uid)} 접속이 끊어졌습니다. (IP: ${ip})`, uid);
    } else if (uid) {
      this.pushLog("info", "연결 해제", `${this.describe(uid)} 의 이전(교체된) 연결이 정리되었습니다.`, uid);
    } else {
      this.pushLog("info", "연결 해제", `미등록 기기 접속이 끊어졌습니다. (IP: ${ip})`);
    }

    this.scheduleSnapshot();
  }

  private runHeartbeat() {
    if (!this.wss) return;
    const now = Date.now();

    this.wss.clients.forEach((socket) => {
      const meta = this.meta.get(socket);
      if (!meta) return;

      if (meta.isAlive === false) {
        this.pushLog(
          "warn",
          "타임아웃",
          `응답 없는 ${meta.uid ? this.describe(meta.uid) : "미등록 기기"} 연결을 강제 종료합니다.`,
          meta.uid,
        );
        socket.terminate();
        return;
      }

      meta.isAlive = false;
      meta.pingSentAt = now;
      try {
        socket.ping();
      } catch {
        /* noop */
      }
    });
  }

  // ----------------------------------------------------------
  // 명령 전송
  // ----------------------------------------------------------

  /** targets 는 표시이름 배열 또는 "all" */
  sendCommand(key: CommandKey, targets: string[] | "all"): CommandResult {
    const cmd = COMMANDS[key];

    const sent: string[] = [];
    const failed: string[] = [];

    if (targets === "all") {
      for (const connection of this.connections.values()) {
        const name = this.nameOf(connection.uid);
        if (this.dispatch(connection.uid, cmd.code)) sent.push(name);
        else failed.push(name);
      }
      this.pushLog(
        "command",
        "전송 완료",
        `접속된 총 ${sent.length}대의 기기에 '${cmd.label}' 일괄 명령을 보냈습니다.`,
      );
    } else {
      for (const target of targets) {
        const entry = this.resolve(target);
        if (!entry) {
          failed.push(target);
          this.pushLog("error", "전송 실패", `매핑 테이블에 없는 기기입니다: ${target}`);
          continue;
        }

        if (this.dispatch(entry.uid, cmd.code)) {
          sent.push(entry.name);
          this.pushLog("command", "전송 완료", `${this.describe(entry.uid)} 에 '${cmd.label}' 명령을 보냈습니다.`, entry.uid);
        } else {
          failed.push(entry.name);
          this.pushLog("error", "전송 실패", `${this.describe(entry.uid)} 은(는) 오프라인 상태입니다.`, entry.uid);
        }
      }
    }

    this.scheduleSnapshot();

    return {
      ok: failed.length === 0 && sent.length > 0,
      command: key,
      label: cmd.label,
      sent,
      failed,
      error:
        sent.length === 0
          ? targets === "all"
            ? "접속된 기기가 없습니다."
            : "대상 기기가 오프라인이거나 목록에 없습니다."
          : undefined,
    };
  }

  /** uid 로 실제 소켓에 명령을 밀어넣는다. */
  private dispatch(uid: string, code: string, deviceId?: string): boolean {
    const connection = this.connections.get(uid);
    if (!connection) return false;

    const payload: Record<string, unknown> = { type: "COMMAND", command: code };
    if (deviceId !== undefined) payload.deviceId = deviceId;

    if (!safeSend(connection.socket, payload)) return false;

    connection.lastCommand = code;
    connection.lastCommandAt = Date.now();
    return true;
  }

  // ----------------------------------------------------------
  // 이름 변경 / 목록에서 제거
  // ----------------------------------------------------------

  /** target 은 현재 표시이름 또는 uid */
  rename(target: string, rawName: string): RenameResult {
    const entry = this.resolve(target);
    if (!entry) {
      return { ok: false, error: `대상을 찾을 수 없습니다: ${target}` };
    }

    const check = validateName(rawName);
    if (!check.ok) return { ok: false, error: check.error };

    const nextName = check.name;
    if (nextName === entry.name) {
      return { ok: false, error: `이미 같은 이름입니다: ${nextName}` };
    }

    if (this.isNameTaken(nextName, entry.uid)) {
      return { ok: false, error: `이미 사용 중인 이름입니다: ${nextName}` };
    }

    const from = entry.name;
    entry.name = nextName;
    entry.updatedAt = Date.now();
    this.persist();

    // 접속 중이면 기기에도 알려 로컬 캐시를 갱신하게 한다.
    const notified = this.dispatch(entry.uid, SET_NAME_CODE, nextName);

    this.pushLog(
      "command",
      "이름 변경",
      `[${from}] -> [${nextName}] (uid ...${uidSuffix(entry.uid)})${notified ? " · 기기에 전달함" : " · 오프라인이라 접속 시 반영"}`,
      entry.uid,
    );
    this.scheduleSnapshot();

    return { ok: true, uid: entry.uid, from, to: nextName, notified };
  }

  /** 매핑 테이블에서 항목을 지운다. 접속 중인 기기는 지울 수 없다. */
  forget(target: string): ForgetResult {
    const entry = this.resolve(target);
    if (!entry) return { ok: false, error: `대상을 찾을 수 없습니다: ${target}` };

    if (this.connections.has(entry.uid)) {
      return { ok: false, error: `접속 중인 기기는 제거할 수 없습니다: ${entry.name}` };
    }

    this.registry.delete(entry.uid);
    this.persist();

    this.pushLog(
      "warn",
      "목록 제거",
      `[${entry.name}] (uid ...${uidSuffix(entry.uid)}) 을(를) 매핑 테이블에서 제거했습니다.`,
      entry.uid,
    );
    this.scheduleSnapshot();

    return { ok: true, uid: entry.uid, name: entry.name };
  }

  // ----------------------------------------------------------
  // 상태 조회 / 구독
  // ----------------------------------------------------------
  getSnapshot(): ServerSnapshot {
    const devices: DeviceView[] = [...this.registry.values()].map((entry) => {
      const connection = this.connections.get(entry.uid);
      if (!connection) return toOfflineView(entry);

      return {
        uid: entry.uid,
        name: entry.name,
        unnamed: isUnnamed(entry.name),
        model: entry.model,
        status: connection.socket.readyState === WebSocket.OPEN ? "online" : "offline",
        ip: connection.ip,
        connectedAt: connection.connectedAt,
        lastSeenAt: connection.lastSeenAt,
        lastCommand: connection.lastCommand,
        lastCommandAt: connection.lastCommandAt,
        lastAck: connection.lastAck,
        lastAckAt: connection.lastAckAt,
        latencyMs: connection.latencyMs,
        battery: connection.battery,
        batteryCharging: connection.batteryCharging,
        batteryAt: connection.batteryAt,
      } satisfies DeviceView;
    });

    // 온라인 우선, 그 다음 미할당 우선, 마지막으로 이름순
    devices.sort((a, b) => {
      if (a.status !== b.status) return a.status === "online" ? -1 : 1;
      if (a.unnamed !== b.unnamed) return a.unnamed ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    });

    let pending = 0;
    this.meta.forEach((m) => {
      if (!m.uid) pending += 1;
    });

    return {
      port: this.port,
      startedAt: this.startedAt,
      devices,
      pending,
      registryPath: this.registryPath,
      error: this.startupError,
    };
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  subscribe(listener: Listener): () => void {
    this.emitter.on("message", listener);
    return () => {
      this.emitter.off("message", listener);
    };
  }

  // ----------------------------------------------------------
  // 내부 유틸
  // ----------------------------------------------------------
  private nameOf(uid: string): string {
    return this.registry.get(uid)?.name ?? `${UNKNOWN_PREFIX}${uidSuffix(uid)}`;
  }

  /** 로그에 쓰는 표준 기기 표기: [이름] (uid ...ABCDEF) */
  private describe(uid: string): string {
    return `[${this.nameOf(uid)}] (uid ...${uidSuffix(uid)})`;
  }

  private pushLog(level: LogLevel, tag: string, message: string, uid?: string | null) {
    const entry: LogEntry = {
      id: ++this.logSeq,
      at: Date.now(),
      level,
      tag,
      message,
      uid: uid ?? null,
    };

    this.logs.push(entry);
    if (this.logs.length > LOG_LIMIT) {
      this.logs = this.logs.slice(-LOG_LIMIT);
    }

    // 콘솔에도 남겨 두면 터미널만 보고도 상황 파악이 된다.
    console.log(`[${tag}] ${message}`);
    this.emitter.emit("message", { type: "log", entry } satisfies StreamMessage);
  }

  /** 상태 변경이 연달아 일어날 때 브로드캐스트를 한 번으로 합친다. */
  private scheduleSnapshot() {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.emitter.emit("message", {
        type: "snapshot",
        snapshot: this.getSnapshot(),
      } satisfies StreamMessage);
    }, SNAPSHOT_DEBOUNCE);
    this.snapshotTimer.unref?.();
  }
}

const UNKNOWN_PREFIX = "UNKNOWN_";

// ============================================================
// 싱글턴
//
// Next.js 는 개발 중 HMR 로 모듈을 다시 평가할 수 있고, instrumentation 과
// route handler 가 서로 다른 번들에 들어갈 수도 있다. globalThis 에 물려
// 두어야 소켓 서버가 한 번만 뜨고 상태도 공유된다.
// ============================================================
const globalRef = globalThis as typeof globalThis & { __LBE_HUB__?: LbeHub };

export function getHub(): LbeHub {
  if (!globalRef.__LBE_HUB__) {
    globalRef.__LBE_HUB__ = new LbeHub();
  }
  return globalRef.__LBE_HUB__;
}

export type { LbeHub };
