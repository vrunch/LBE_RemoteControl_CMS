# LBE 원격 제어 — 구현과 사용 가이드

운영자 PC 한 대에서 여러 대의 VR HMD를 원격으로 제어하는 시스템입니다.
이 문서는 **어떻게 만들어졌는지**와 **어떻게 쓰는지**를 함께 다룹니다.

- 빠른 시작만 필요하면 [README.md](../README.md) 를 보세요.
- Unity 쪽 코드는 `VRRemoteClient.cs` 입니다.

---

## 목차

1. [전체 그림](#1-전체-그림)
2. [핵심 설계: uid 와 표시이름](#2-핵심-설계-uid-와-표시이름)
3. [매핑 테이블 (devices.json)](#3-매핑-테이블-devicesjson)
4. [통신 규격](#4-통신-규격)
5. [서버 구현](#5-서버-구현)
6. [웹 대시보드 구현](#6-웹-대시보드-구현)
7. [사용법 — 웹 대시보드](#7-사용법--웹-대시보드)
8. [사용법 — 콘솔 모드](#8-사용법--콘솔-모드)
9. [Unity 클라이언트 연동](#9-unity-클라이언트-연동)
10. [문제 해결](#10-문제-해결)
11. [설정값 정리](#11-설정값-정리)

---

## 1. 전체 그림

```
┌──────────────────────────────────────────────────────────────┐
│  운영자 PC                                                    │
│                                                              │
│   ┌─────────────────┐   SSE /api/stream    ┌──────────────┐  │
│   │  브라우저        │ ◀────────────────────│              │  │
│   │  (대시보드)      │                      │  Next.js     │  │
│   │                 │ ─────────────────────▶│  서버        │  │
│   └─────────────────┘   POST /api/command   │              │  │
│         :3000            /api/rename        │  ┌────────┐  │  │
│                          /api/forget        │  │ 허브    │  │  │
│                                             │  │(hub.ts)│  │  │
│                                             │  └───┬────┘  │  │
│                                             └──────┼───────┘  │
│                                        devices.json│          │
└─────────────────────────────────────────────────────┼─────────┘
                                     WebSocket :7485  │
                    ┌─────────────────────┬───────────┴──────────┐
                    │                     │                      │
              ┌─────▼─────┐         ┌─────▼─────┐          ┌─────▼─────┐
              │  HMD_01   │         │  HMD_02   │   ...    │  HMD_13   │
              │  (Unity)  │         │  (Unity)  │          │  (Unity)  │
              └───────────┘         └───────────┘          └───────────┘
```

프로세스는 **하나**입니다. Next.js 서버가 뜰 때 웹소켓 허브가 같은 프로세스 안에서 함께 기동됩니다.
따라서 웹 UI와 소켓 서버가 메모리를 그대로 공유하며, 별도의 브로커나 DB가 없습니다.

부팅 지점은 [`src/instrumentation.ts`](../src/instrumentation.ts) 입니다.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getHub } = await import("@/server/hub");
  getHub();
}
```

Next.js가 서버 프로세스를 띄울 때 딱 한 번 실행되므로, 첫 HTTP 요청이 오기 전부터 HMD 접속을 받을 수 있습니다.

> **왜 싱글턴을 `globalThis` 에 두는가**
> 개발 모드의 HMR이나 번들 분리 때문에 `hub.ts` 모듈이 두 번 평가될 수 있습니다.
> 그러면 `WebSocketServer` 가 두 번 떠서 포트 충돌이 납니다. `globalThis.__LBE_HUB__` 에
> 물려 두면 모듈이 몇 번 평가되든 실제 인스턴스는 하나입니다.

---

## 2. 핵심 설계: uid 와 표시이름

이 시스템에서 가장 중요한 원칙입니다.

| | uid | 표시이름 (name) |
|---|---|---|
| 정체 | 기기 하드웨어 고유값 | 운영자가 읽는 별칭 |
| 출처 | Unity `SystemInfo.deviceUniqueIdentifier` | **서버의 매핑 테이블** |
| 변하나? | 안 변함 (공장 초기화 제외) | 운영자가 언제든 변경 |
| 역할 | **소켓 관리 키**, 테이블 기본키 | 사람이 지정할 때 쓰는 라벨 |
| 예시 | `4290fb858c28baef855203c0d8e3b08d` | `HMD_13` |

### 왜 이렇게 나눴나

이름을 기기가 들고 있으면 다음 문제가 생깁니다.

- 앱을 재설치하면 이름이 날아감
- 두 기기가 같은 이름을 주장하면 서로를 덮어씀
- 기기 로컬 파일을 고치면 남의 이름을 가로챌 수 있음

그래서 **이름의 원본은 서버가 소유**하고, 기기는 uid만 주장합니다.

### 절대 규칙

> 클라이언트가 `REGISTER` 에 실어 보내는 `deviceId` 는 **참고용**이며,
> **어떤 경우에도 매핑 테이블을 덮어쓰지 못합니다.**

기기가 보낸 캐시 이름이 서버 테이블과 다르면 서버는 무시하고 로그만 남깁니다.

```
[이름 동기화] 기기가 보낸 캐시 이름 [OLD_CACHE] 대신 매핑 테이블의 [HMD_13] 을(를) 적용합니다.
```

### 처음 보는 기기

테이블에 없는 uid가 접속하면 **`UNNAMED_<uid 뒤 6자리 대문자>`** 로 자동 등록됩니다.

```
uid 4290fb858c28baef855203c0d8e3b08d  →  UNNAMED_E3B08D
```

뒤 6자리가 겹치는 기기가 있으면 `UNNAMED_E3B08D-2` 처럼 접미사를 붙여 이름 유일성을 지킵니다.

> 자릿수는 [`src/lib/protocol.ts`](../src/lib/protocol.ts) 의 `UID_SUFFIX_LENGTH` 상수 하나로 관리합니다.
> **Unity 쪽 `Last6()` 과 반드시 같아야 합니다.**

### 이름 규칙

영문, 숫자, `_`, `-` 만 허용하며 최대 32자입니다. 중복 이름은 거부됩니다(대소문자 무시).

콘솔에서 `rename HMD_01 새이름` 처럼 공백으로 인자를 쪼개기 때문에 공백을 허용하지 않습니다.

> Unity의 `SanitizeName()` 은 `char.IsLetterOrDigit` 을 쓰므로 한글도 통과시키지만,
> 서버는 ASCII만 허용합니다. 한글 이름은 거부됩니다.

---

## 3. 매핑 테이블 (devices.json)

uid → 표시이름 매핑을 담은 파일입니다. 프로젝트 루트에 생성됩니다.

```jsonc
{
  "version": 1,
  "devices": [
    {
      "uid": "4290fb858c28baef855203c0d8e3b08d",  // 기본키
      "name": "HMD_13",                            // 운영자가 지정한 이름
      "model": "Pico A94U0",                       // REGISTER 때 받은 모델명
      "updatedAt": 1785392568614,                  // 이름/모델 최종 변경 시각
      "lastConnectedAt": 1785392568614             // 마지막 접속 시각
    }
  ]
}
```

- **읽기**: 서버 시작 시 1회
- **쓰기**: 신규 등록 / 이름 변경 / 목록 제거 / 모델 갱신 때마다 즉시

### 저장이 안전한 이유

임시 파일에 먼저 쓰고 원본으로 교체(rename)합니다. 저장 도중 프로세스가 죽어도 원본이 반쯤 쓰인 상태로 깨지지 않습니다.
rename이 막히는 환경(파일 잠금 등)에서는 직접 쓰기로 물러섭니다.

### 깨져도 죽지 않는 이유

| 상황 | 동작 |
|---|---|
| 파일 없음 | 안내 로그 후 빈 목록으로 시작 |
| JSON 문법 오류 | **경고** 로그 후 빈 목록으로 시작 (원본은 덮어쓰기 전까지 보존) |
| 일부 항목만 불량 | 그 항목만 건너뛰고 나머지는 로드, 건너뛴 개수를 경고로 표시 |
| `name` 이 규칙 위반 | 허용 문자만 남기고 정리, 비면 `UNNAMED_` 로 되돌림 |

어떤 경우에도 예외를 던지지 않습니다. 구현은 [`src/server/registry.ts`](../src/server/registry.ts) 입니다.

### 백업

`devices.json` 은 기기 이름의 **유일한 원본**입니다. 현장 배치가 끝나면 이 파일을 따로 보관해 두세요.
파일을 잃으면 모든 기기가 `UNNAMED_` 로 되돌아갑니다(기기는 멀쩡히 붙지만 이름을 다시 지정해야 함).

---

## 4. 통신 규격

모든 패킷은 평평한 JSON 하나입니다. Unity의 `JsonUtility` 는 중첩 객체 처리가 까다로워 필드를 펼쳐 두었습니다.

```csharp
public class WSMessage {
    public string type;      // REGISTER / REGISTERED / COMMAND / ACK / PING / PONG
    public string uid;       // 기기 고유값
    public string deviceId;  // 표시이름
    public string command;   // 명령 코드
    public string status;    // ACK 결과
    public string model;     // 기기 모델명
}
```

### 명령 코드

Unity `VRRemoteClient.Commands` 와 문자열이 정확히 일치해야 합니다.

| 명령 | 코드 | 용도 |
|---|---|---|
| 기기 확인 | `IDENTIFY` | HMD 화면에 자기 이름 + uid 뒤 6자리 표시 |
| 앱 실행 | `LAUNCH_APP` | LBE 앱 실행 |
| 게임 초기화 | `RESET_GAME` | 진행 중인 게임을 처음 상태로 |
| 앱 종료 | `QUIT_APP` | 앱 종료 |
| 이름 변경 | `SET_NAME` | 서버가 확정한 새 이름 통보 (운영자가 직접 고르지 않음) |

### 주고받는 순서

```
기기                                        서버
 │                                           │
 │  ── WebSocket 연결 ──────────────────────▶ │  [연결됨]
 │                                           │
 │  { type: "REGISTER",                      │
 │    uid: "4290fb85...",                    │
 │    deviceId: "캐시된이름",   ← 참고용        │
 │    model: "Pico A94U0" }  ───────────────▶ │  테이블 조회
 │                                           │   ├ 있으면 → 그 이름
 │                                           │   └ 없으면 → UNNAMED_XXXXXX 자동 등록 + 저장
 │                                           │
 │  ◀────── { type: "REGISTERED",            │  [등록 완료]
 │            uid: "4290fb85...",            │
 │            deviceId: "HMD_13" }           │
 │  로컬 캐시 갱신                             │
 │                                           │
 │  ◀────── { type: "COMMAND",               │  운영자가 버튼 클릭
 │            command: "RESET_GAME" }        │  [전송 완료]
 │                                           │
 │  { type: "ACK",                           │
 │    uid: "...", deviceId: "HMD_13",        │
 │    command: "RESET_GAME",                 │
 │    status: "OK" }  ─────────────────────▶ │  [응답]
 │                                           │
 │  ◀────── ping (10초 주기)                  │  하트비트
 │  pong ──────────────────────────────────▶ │  왕복 시간 = 지연(ms)
```

### 이름 변경일 때만 다른 점

`SET_NAME` 은 `deviceId` 필드에 새 이름이 함께 실립니다.

```jsonc
{ "type": "COMMAND", "command": "SET_NAME", "deviceId": "HMD_02" }
```

기기는 이 값을 받아 로컬 캐시 파일(`websocket_name.txt`)을 갱신하고 `ACK` 를 돌려줍니다.

### 부가 규격

- `{ "type": "PING" }` 을 보내면 서버가 `{ "type": "PONG" }` 으로 답합니다 (애플리케이션 레벨)
- 알 수 없는 `type` 은 **경고 로그만 남기고 무시**합니다
- JSON이 아닌 데이터도 무시합니다
- `uid` 가 비어 있는 `REGISTER` 는 거부합니다

---

## 5. 서버 구현

### 파일 구성

```
src/
├─ instrumentation.ts        Next 기동 시 허브 부팅 (진입점)
├─ server/
│  ├─ hub.ts                 소켓 관리 · 명령 전송 · 이름 변경 · 로그
│  └─ registry.ts            devices.json 읽기/쓰기
├─ lib/
│  └─ protocol.ts            서버·UI 공용 타입, 명령 코드, 이름 규칙
└─ app/api/
   ├─ stream/route.ts        SSE — 상태·로그 실시간 전송
   ├─ command/route.ts       POST — 명령 전송
   ├─ rename/route.ts        POST — 이름 변경
   └─ forget/route.ts        POST — 목록에서 제거
```

`protocol.ts` 는 **브라우저 번들에도 들어갑니다.** Node 전용 모듈을 import 하면 안 됩니다.
덕분에 명령 코드와 이름 규칙이 서버·UI·콘솔에서 한 벌로 유지됩니다.

### 허브가 들고 있는 상태

```ts
registry:    Map<uid, RegistryEntry>   // 매핑 테이블 (오프라인 기기 포함)
connections: Map<uid, Connection>      // 지금 붙어 있는 소켓
meta:        Map<WebSocket, SocketMeta> // 소켓별 부가 정보 (IP, 생존 플래그, uid)
logs:        LogEntry[]                 // 최근 500건 링 버퍼
```

**`connections` 의 키가 uid** 라는 점이 핵심입니다. 이름이 바뀌어도 소켓 매핑은 흔들리지 않습니다.

`meta` 가 따로 있는 이유는 **아직 `REGISTER` 를 하지 않은 소켓**도 추적해야 하기 때문입니다.
이 개수가 대시보드의 "등록 대기" 수치입니다.

### 재접속 처리

같은 uid로 새 소켓이 붙으면 이전 소켓을 끊습니다. 여기에 함정이 하나 있습니다.

```ts
// 이전 소켓을 close() 하면 그 소켓의 'close' 핸들러가 나중에 실행된다.
// 그때 무심코 connections.delete(uid) 하면 방금 등록한 새 소켓이 지워진다.
if (uid && this.connections.get(uid)?.socket === socket) {
  this.connections.delete(uid);   // "내가 등록한 소켓이 맞을 때만" 삭제
}
```

이 가드가 없으면 HMD가 Wi-Fi 재연결할 때마다 목록에서 사라지는 버그가 납니다.

### 하트비트

Wi-Fi가 갑자기 끊긴 HMD는 `close` 이벤트를 보내지 못해 목록에 유령으로 남습니다.
10초마다 ping을 보내고, 다음 주기까지 pong이 없으면 강제로 끊습니다.

ping을 보낸 시각과 pong을 받은 시각의 차이가 대시보드에 표시되는 **지연(ms)** 입니다.

### 명령 전송 경로

운영자는 **표시이름**으로 대상을 지정하고, 서버가 uid로 역해석합니다.

```
"HMD_13" ──▶ registry 조회 ──▶ uid 4290fb85... ──▶ connections 조회 ──▶ 소켓에 전송
```

이름을 못 찾으면 `전송 실패`, 찾았지만 오프라인이면 `오프라인 상태` 로 구분해 알려줍니다.

### 로그

모든 이벤트는 `[태그] 메시지` 형태로 남고, 콘솔과 웹 UI에 동시에 나갑니다.

| 레벨 | 태그 |
|---|---|
| `success` | 서버 시작, 등록 완료, 신규 등록, 응답(OK) |
| `command` | 전송 완료, 이름 변경 |
| `info` | 연결됨, 연결 해제, 이름 동기화, 매핑 테이블 |
| `warn` | 중복 감지, 타임아웃, 등록 실패, 무시됨, 알 수 없는 타입, 목록 제거, 응답(실패) |
| `error` | 서버 오류, 소켓 오류, 전송 실패 |

기기가 관련된 로그는 항상 `[이름] (uid ...ABCDEF)` 형태로 **이름과 uid를 함께** 찍습니다.
이름이 바뀌어도 로그를 uid로 추적할 수 있습니다.

### HTTP API

| 메서드 | 경로 | 본문 | 설명 |
|---|---|---|---|
| GET | `/api/stream` | — | SSE. 접속 즉시 전체 상태 + 로그, 이후 변경분 |
| POST | `/api/command` | `{ command, targets }` | `targets` 는 이름 배열 또는 `"all"` |
| POST | `/api/rename` | `{ target, name }` | `target` 은 현재 이름 또는 uid |
| POST | `/api/forget` | `{ target }` | 오프라인 기기만 제거 가능 |

`command` 는 `identify` / `start` / `reset` / `quit` 중 하나입니다.

```bash
# 예시: 전체 기기 게임 초기화
curl -X POST http://localhost:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"reset","targets":"all"}'

# 예시: 이름 변경
curl -X POST http://localhost:3000/api/rename \
  -H "Content-Type: application/json" \
  -d '{"target":"UNNAMED_E3B08D","name":"HMD_13"}'
```

응답 예시:

```jsonc
{ "ok": true, "command": "reset", "label": "게임 초기화",
  "sent": ["HMD_13"], "failed": [] }

{ "ok": true, "uid": "4290fb85...", "from": "UNNAMED_E3B08D",
  "to": "HMD_13", "notified": true }   // notified: 기기에 SET_NAME 을 실제로 보냈는지
```

---

## 6. 웹 대시보드 구현

### 실시간 갱신은 SSE

브라우저 ↔ 서버는 웹소켓이 아니라 **SSE(Server-Sent Events)** 를 씁니다.

- 서버 → 브라우저 단방향 푸시만 필요 (명령은 평범한 POST로 충분)
- Next.js Route Handler로 그대로 구현 가능 (커스텀 서버 불필요)
- 끊기면 브라우저의 `EventSource` 가 알아서 재연결

상태 변경이 몰릴 때는 60ms 동안 묶어 한 번만 브로드캐스트합니다.
15초마다 keepalive 프레임을 보내 유휴 커넥션이 끊기지 않게 합니다.

### 상태 흐름

```
hub (서버 메모리)
  │  EventEmitter
  ▼
/api/stream (SSE)
  │  data: { type: "init" | "snapshot" | "log", ... }
  ▼
LbeProvider (React Context)
  │  snapshot / logs / connected / sendCommand / renameDevice / forgetDevice
  ▼
Sidebar · TopBar · StatCards · BulkControl · DeviceTable · LogPanel
```

SSE 연결은 `LbeProvider` 에서 **한 개만** 열고 Context로 나눠 씁니다.

### 주의해서 만든 부분

**하이드레이션 안전한 시계** — Next.js는 클라이언트 컴포넌트도 서버에서 한 번 렌더합니다.
`useState(() => Date.now())` 로 두면 서버 시각과 브라우저 시각이 달라 hydration mismatch가 납니다.
`useSyncExternalStore` 로 바꾸고 서버 스냅샷은 `0` 을 고정 반환하게 했습니다.
시각을 그대로 찍는 곳은 `now === 0` 일 때 `--:--:--` 를 표시합니다.
덤으로 컴포넌트마다 돌던 타이머가 하나로 줄었습니다.

**선택 상태는 uid로** — 기기 체크박스 선택은 이름이 아니라 uid로 들고 있습니다.
이름 변경 중에도 선택이 엉키지 않습니다.

---

## 7. 사용법 — 웹 대시보드

### 시작

```bash
pnpm install
pnpm dev
```

- 대시보드: <http://localhost:3000>
- 기기 접속 주소: `ws://<서버 IP>:7485`

같은 네트워크의 다른 PC에서 열려면 터미널에 찍히는 `Network:` 주소를 쓰세요.

> `pnpm dev` 와 `pnpm console` 을 **동시에 실행하면 안 됩니다.** 둘 다 7485 포트를 씁니다.

### 화면 구성

| 메뉴 | 내용 |
|---|---|
| **대시보드** | 통계 카드, 일괄 제어, 기기 목록, 최근 활동 |
| **실시간 로그** | 전체 이벤트 기록 (레벨 필터 · 검색 · 자동 추적) |
| **연결 정보** | 접속 주소, 식별 체계 설명, 명령 코드표, 통신 규격 |

### 처음 배치할 때 — 미할당 기기에 이름 붙이기

HMD 5대를 새로 세팅한다고 하면 목록에 이렇게 뜹니다.

```
UNNAMED_E3B08D   [미할당]   온라인   Pico A94U0
UNNAMED_A11C4F   [미할당]   온라인   Pico A94U0
...
```

어느 것이 어느 헤드셋인지 알 수 없으므로:

1. 한 기기의 **기기 확인(눈 아이콘)** 버튼을 누릅니다
2. 5대 중 한 대의 화면에 `UNNAMED_E3B08D` 와 uid 뒤 6자리가 5초간 뜹니다
3. 그 헤드셋이 물리적으로 어디 있는지 확인합니다
4. 이름 옆 **연필 아이콘** → `HMD_01` 입력 → 변경
5. 나머지도 반복

이름을 바꾸면 접속 중인 기기에 `SET_NAME` 이 즉시 전달되어 로컬 캐시까지 갱신됩니다.

### 평소 운영

- **일괄 제어** 패널: 접속된 전 기기에 한 번에 명령
- **기기별 제어**: 각 행 오른쪽 버튼 (기기 확인 / 앱 실행 / 게임 초기화 / 앱 종료)
- **선택 제어**: 체크박스로 여러 대 고른 뒤 목록 헤더의 버튼

앱 종료·게임 초기화를 여러 대에 한 번에 보낼 때는 확인 창이 한 번 뜹니다.

### 기기 목록 읽는 법

| 열 | 의미 |
|---|---|
| 기기 | 표시이름, `미할당` 배지, uid 뒤 6자리, IP |
| 상태 | 온라인 / 오프라인 |
| 모델 | `REGISTER` 때 받은 기기 모델명 |
| 지연 | ping/pong 왕복 시간. 초록 <80ms, 노랑 <250ms, 빨강 그 이상 |
| 최근 명령 | 마지막으로 보낸 명령과 경과 시간 |
| 최근 응답 | 기기가 회신한 ACK 상태 |
| 접속 시간 | 온라인이면 접속 지속 시간, 오프라인이면 마지막 접속 시점 |

오프라인 기기도 목록에 남습니다(매핑 테이블에 있으므로). 이름 변경과 목록 제거만 가능합니다.

### 목록에서 제거

오프라인 기기의 **휴지통 아이콘** 으로 매핑 테이블에서 지웁니다.
안 쓰는 기기가 목록에 계속 쌓이는 걸 막는 용도입니다.

- 접속 중인 기기는 제거할 수 없습니다
- 제거해도 다시 접속하면 uid 기준으로 재등록되며 `UNNAMED_` 이름이 새로 붙습니다

---

## 8. 사용법 — 콘솔 모드

웹 UI 없이 터미널만 쓰고 싶을 때입니다. 웹 대시보드와 **같은 `devices.json` 을 공유**합니다.

```bash
pnpm console        # = node server.js
```

### 명령어

| 명령 | 단축키 | 설명 |
|---|---|---|
| `list` | `1` | 접속 목록 — 이름, uid 뒤 6자리, 모델, 상태 |
| `quit [대상]` | `2` | 앱 종료 |
| `start [대상]` | `3` | 앱 실행 |
| `reset [대상]` | `4` | 게임 초기화 |
| `identify [대상]` | `5` | HMD 화면에 자기 이름 표시 |
| `rename [대상] [새이름]` | — | 표시이름 변경 |
| `help` | `?` | 안내 다시 보기 |

`[대상]` 에는 **표시이름 또는 uid** 를 넣습니다. `all` 은 접속된 전체입니다.

```bash
list
reset all
quit HMD_01
identify UNNAMED_E3B08D
rename UNNAMED_E3B08D HMD_13
rename 4290fb858c28baef855203c0d8e3b08d HMD_13   # uid 로도 가능
3 HMD_01                                          # 단축키
```

### `list` 출력 예시

미할당 기기는 눈에 띄게 표시됩니다.

```
--- 현재 연결된 LBE 기기 목록 ---
- HMD_13               uid ...E3B08D  Pico A94U0         ONLINE
- UNNAMED_A11C4F       uid ...A11C4F  Pico A94U0         ONLINE  <== 미할당! identify 로 실물 확인 후 rename 하세요
총 2대 접속 중 / 매핑 테이블 5대 등록

[오프라인 3대] HMD_02, HMD_03, HMD_04
```

---

## 9. Unity 클라이언트 연동

### 설정

`VRRemoteClient` 컴포넌트의 인스펙터에서:

| 항목 | 설명 |
|---|---|
| `serverUrl` | `ws://<서버 PC IP>:7485` |
| `reconnectDelay` | 연결 끊겼을 때 재시도 간격(초). 기본 3 |
| `labelCacheFile` | 서버가 준 이름을 캐시할 파일명. 지워져도 무방 |
| `editorDeviceName` | 에디터에서만 쓸 이름 |
| `identifyText` | `IDENTIFY` 때 이름을 띄울 TMP_Text |
| `identifyDuration` | 표시 유지 시간(초). 기본 5 |

### 구현해야 할 부분

`VRRemoteClient.cs` 의 아래 함수들이 **TODO 로 비어 있습니다.** 실제 동작은 앱에 맞게 채워야 합니다.

```csharp
private void ExecuteQuitApp()   { /* TODO: 앱 종료 로직 */ }
private void ExecuteLaunchApp() { /* TODO: 앱 실행 로직 */ }
private void ExecuteResetGame() { /* TODO: 게임 초기화 로직 */ }
```

`ExecuteIdentify()` 는 이미 동작합니다(이름 + uid 뒤 6자리 표시).

### 서버 없이 테스트

인스펙터 우클릭 메뉴에서 명령을 직접 실행할 수 있습니다.

```
Test / 앱 종료
Test / 앱 실행
Test / 게임 초기화
Test / IDENTIFY 표시
Info / 기기 식별 정보 출력
```

### 자릿수를 바꿀 때

Unity의 `Last6()` 을 고치면 서버의 `UID_SUFFIX_LENGTH` 도 같이 바꿔야 합니다.

| 위치 | 상수 |
|---|---|
| `src/lib/protocol.ts` | `UID_SUFFIX_LENGTH` |
| `server.js` | `UID_SUFFIX_LENGTH` |
| `VRRemoteClient.cs` | `Last6()` |

---

## 10. 문제 해결

### 기기가 목록에 안 나옴

1. HMD와 서버 PC가 **같은 네트워크**에 있는지
2. `serverUrl` 의 IP가 맞는지 (연결 정보 페이지의 주소를 그대로 복사)
3. 서버 PC 방화벽이 **7485 포트**를 막고 있지 않은지
4. Unity 콘솔에 `[VR Client] 등록 요청 보냄` 이 찍히는지

대시보드 로그에 `[연결됨]` 은 뜨는데 `[등록 완료]` 가 없으면 `REGISTER` 패킷 문제입니다.
`[등록 실패] uid가 비어 있습니다` 가 뜨면 Unity 쪽 `uid` 가 비어서 온 것입니다.

### "7485 포트가 이미 사용 중입니다"

`pnpm dev` 와 `pnpm console` 을 동시에 켰거나, 이전 서버가 안 죽고 남아 있습니다.

```powershell
# 7485 를 잡고 있는 프로세스 확인
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 7485 }
# 종료
Stop-Process -Id <PID> -Force
```

이 상태에서도 웹 UI 자체는 뜨고, 대시보드 상단에 오류 배너가 표시됩니다.

### 이름을 바꿨는데 기기에 반영이 안 됨

기기가 오프라인이면 서버 테이블만 바뀌고 `SET_NAME` 은 나가지 않습니다.
다음 접속 때 `REGISTERED` 로 새 이름을 받아 갑니다. 정상 동작입니다.

응답의 `notified` 필드가 이를 알려줍니다.

### 기기가 목록에서 사라졌다 나타남

Wi-Fi가 불안정하면 하트비트 타임아웃으로 끊겼다가 재접속합니다.
로그에 `[타임아웃]` 이 반복되면 무선 환경을 점검하세요. 지연(ms) 열도 함께 보면 판단이 쉽습니다.

### `devices.json` 이 깨졌다는 경고

서버는 빈 목록으로 시작하고 **원본 파일은 그대로 둡니다.**
파일을 직접 열어 고치거나, 백업으로 되돌린 뒤 서버를 재시작하세요.
그냥 두고 이름을 새로 지정하면 다음 저장 때 정상 형식으로 덮어써집니다.

### 브라우저에 hydration 오류

이전 번들이 캐시된 경우입니다. **Ctrl+Shift+R** 로 강력 새로고침 하세요.

---

## 11. 설정값 정리

### 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `LBE_WS_PORT` | `7485` | 기기 접속용 웹소켓 포트 |
| `LBE_DEVICES_FILE` | `./devices.json` | 매핑 테이블 경로 |

```bash
LBE_WS_PORT=7500 pnpm dev
```

웹 UI 포트(기본 3000)는 `pnpm dev -- -p 3100` 으로 바꿉니다.

### 코드 상수

| 값 | 위치 | 기본값 |
|---|---|---|
| 하트비트 주기 | `hub.ts` `HEARTBEAT_INTERVAL` | 10초 |
| 상태 브로드캐스트 묶음 | `hub.ts` `SNAPSHOT_DEBOUNCE` | 60ms |
| SSE keepalive | `stream/route.ts` `KEEPALIVE_INTERVAL` | 15초 |
| 로그 보관 개수 | `protocol.ts` `LOG_LIMIT` | 500건 |
| 이름 최대 길이 | `protocol.ts` `NAME_MAX_LENGTH` | 32자 |
| uid 표기 자릿수 | `protocol.ts` `UID_SUFFIX_LENGTH` | 6 |

### 명령 추가하는 법

1. `src/lib/protocol.ts` 의 `COMMANDS` 에 항목 추가 (+ `COMMAND_KEYS` 순서)
2. `server.js` 의 `COMMANDS` 에도 동일하게 추가
3. Unity `VRRemoteClient.Commands` 에 상수 추가 + `RouteCommand` 에 `case` 추가

`COMMANDS` 에 추가하면 대시보드의 일괄 제어·행 버튼·연결 정보 페이지에 자동으로 반영됩니다.
아이콘만 `BulkControl.tsx` / `DeviceTable.tsx` 의 액션 배열에 지정하면 됩니다.
