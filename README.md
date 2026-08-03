# LBE 원격 제어 콘솔

웹소켓으로 LBE(VR HMD) 기기를 원격 제어하는 관제 대시보드입니다.

> 📖 **구현 방식과 상세 사용법은 [docs/REMOTE_CONTROL.md](docs/REMOTE_CONTROL.md) 를 보세요.**
> 기기 배치 절차, 통신 규격, 서버 구조, 문제 해결까지 정리돼 있습니다.

## 실행

```bash
pnpm install
pnpm dev
```

- 대시보드: <http://localhost:3000>
- 기기 접속용 웹소켓: `ws://<서버 IP>:7485`

Next 서버가 뜰 때 웹소켓 허브가 함께 기동됩니다. 별도로 `server.js` 를 띄울 필요가 없고,
**동시에 실행하면 7485 포트가 겹쳐** 대시보드에 오류가 표시됩니다.

같은 네트워크의 다른 PC에서 접속하려면 터미널에 찍히는 `Network:` 주소를 사용하세요.

### 프로덕션

```bash
pnpm build
pnpm start
```

### 레거시 콘솔 모드

기존 방식이 필요하면 그대로 남아 있습니다. 웹 UI와 같은 `devices.json` 을 공유합니다. (동시 실행 불가)

```bash
pnpm console   # = node server.js
```

## 기기 식별 체계

이름이 아니라 **uid** 가 기기를 가리키는 유일한 기준입니다.

| 구분 | 설명 |
| --- | --- |
| `uid` | 기기 하드웨어 고유값(`SystemInfo.deviceUniqueIdentifier`). 소켓 관리 키이자 매핑 테이블의 기본키 |
| 표시이름 | 운영자가 읽는 별칭. **서버의 `devices.json` 이 소유**합니다 |
| `UNNAMED_xxxxxx` | 처음 보는 uid 에 자동으로 붙는 임시 이름 (uid 뒤 6자리) |

클라이언트가 `REGISTER` 에 실어 보내는 `deviceId` 는 **참고용일 뿐 매핑 테이블을 절대 덮어쓰지 않습니다.**
서버가 `REGISTERED` 로 확정 이름을 내려주면 기기가 그 이름을 로컬에 캐시합니다.

미할당 기기 운영 순서:

1. 대시보드에서 `UNNAMED_` 배지가 붙은 기기를 확인
2. **기기 확인(IDENTIFY)** 을 보내면 해당 HMD 화면에 자기 이름이 뜸 → 실물이 어느 헤드셋인지 파악
3. 이름 옆 연필 아이콘으로 원하는 이름 지정 → 접속 중이면 `SET_NAME` 이 즉시 전달됨

### `devices.json`

uid → 표시이름 매핑 테이블입니다. 서버 시작 시 로드하고, 변경될 때마다 즉시 저장합니다.
파일이 없거나 깨져 있으면 경고만 남기고 빈 목록으로 시작합니다(크래시하지 않음).
경로는 `LBE_DEVICES_FILE` 로 바꿀 수 있습니다.

```jsonc
{
  "version": 1,
  "devices": [
    { "uid": "4290fb85...", "name": "HMD_01", "model": "Pico A94U0",
      "updatedAt": 1785390219402, "lastConnectedAt": 1785390219402 }
  ]
}
```

## 화면

| 메뉴 | 설명 |
| --- | --- |
| 대시보드 | 기기 현황 요약, 일괄 제어, 기기별 제어, 이름 변경, 최근 활동 |
| 실시간 로그 | 서버 이벤트 전체 기록 (레벨 필터 · 검색 · 자동 추적) |
| 연결 정보 | 접속 주소, 식별 체계, 명령 코드, JSON 통신 규격 |

기기 목록과 로그는 SSE(`/api/stream`)로 실시간 갱신됩니다. 새로고침이 필요 없습니다.
목록에는 접속 중인 기기와 등록만 되어 있는 오프라인 기기가 함께 나오며,
오프라인 기기는 이름 변경과 목록 제거만 할 수 있습니다.

여러 대를 한 번에 끄거나 초기화할 때는 확인 창이 한 번 뜹니다.

## 콘솔 명령 (`pnpm console`)

| 명령 | 설명 |
| --- | --- |
| `list` (1) | 접속 목록 — 표시이름, uid 뒤 6자리, model, 상태. 미할당 기기는 눈에 띄게 표시 |
| `quit [대상]` (2) | 앱 종료 |
| `start [대상]` (3) | 앱 실행 |
| `reset [대상]` (4) | 게임 초기화 |
| `identify [대상]` (5) | HMD 화면에 자기 이름 표시 |
| `rename [대상] [새이름]` | 표시이름 변경 + `devices.json` 저장 + 접속 중이면 `SET_NAME` 전송 |

`[대상]` 자리에는 **표시이름 또는 uid** 를 넣습니다. `all` 은 접속된 전체입니다.
이름 규칙은 영문/숫자/`_`/`-` 만, 최대 32자이며 중복 이름은 거부됩니다.

## 통신 규격

Unity 쪽 `VRRemoteClient.Commands` 문자열과 반드시 일치해야 합니다.

| 명령 | 전송 코드 |
| --- | --- |
| 기기 확인 | `IDENTIFY` |
| 앱 실행 | `LAUNCH_APP` |
| 게임 초기화 | `RESET_GAME` |
| 앱 종료 | `QUIT_APP` |
| 이름 변경 | `SET_NAME` (운영자가 직접 고르지 않고 rename 시 자동 전송) |

```jsonc
// 1. 기기 등록 (기기 → 서버) — uid 필수, deviceId 는 참고용
{ "type": "REGISTER", "uid": "4290fb85...", "deviceId": "HMD_01", "model": "Quest 3" }
// 2. 등록 확인 (서버 → 기기) — 서버가 확정한 이름
{ "type": "REGISTERED", "uid": "4290fb85...", "deviceId": "HMD_01" }
// 3. 명령 (서버 → 기기) — SET_NAME 일 때만 deviceId 동반
{ "type": "COMMAND", "command": "RESET_GAME" }
{ "type": "COMMAND", "command": "SET_NAME", "deviceId": "HMD_02" }
// 4. 수행 결과 (기기 → 서버)
{ "type": "ACK", "uid": "4290fb85...", "deviceId": "HMD_01", "command": "RESET_GAME", "status": "OK" }
```

서버는 10초마다 웹소켓 ping 을 보내 생존을 확인합니다. 응답 없는 기기는 목록에서 자동 제거되므로
클라이언트는 pong 을 그대로 회신해야 합니다. 같은 `uid` 로 새 소켓이 붙으면 이전 연결은 끊깁니다.
알 수 없는 `type` 은 경고 로그만 남기고 무시합니다.

## 구조

```
src/
├─ instrumentation.ts        Next 기동 시 웹소켓 허브 부팅
├─ server/hub.ts             웹소켓 서버 · 소켓 관리(uid 키) · 명령 · 로그
├─ server/registry.ts        uid → 표시이름 매핑 테이블 (devices.json 입출력)
├─ lib/protocol.ts           서버/UI 공용 명령·타입·이름 규칙
├─ app/api/stream/route.ts   SSE - 기기 상태와 로그 실시간 전송
├─ app/api/command/route.ts  POST - 명령 전송 (표시이름 → uid 역해석)
├─ app/api/rename/route.ts   POST - 표시이름 변경
├─ app/api/forget/route.ts   POST - 매핑 테이블에서 제거
└─ components/               대시보드 UI
```

포트를 바꾸려면 `LBE_WS_PORT` 환경 변수를 지정하세요.
