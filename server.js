const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ============================================================
// 설정
// ============================================================
const PORT = Number(process.env.LBE_WS_PORT || 7485);
const HEARTBEAT_INTERVAL = 10000; // 10초마다 생존 확인 (죽은 소켓 청소용)

// uid -> 표시이름 매핑 테이블 파일 (웹 대시보드와 동일한 파일을 공유)
const DEVICES_FILE = process.env.LBE_DEVICES_FILE
    ? path.resolve(process.env.LBE_DEVICES_FILE)
    : path.join(process.cwd(), 'devices.json');

// 서버 <-> 클라이언트 공통 명령 규격
// Unity 쪽 VRRemoteClient.Commands 의 문자열과 반드시 일치해야 합니다.
const COMMANDS = {
    quit:     { code: 'QUIT_APP',   label: '앱 종료' },
    start:    { code: 'LAUNCH_APP', label: '앱 실행' },
    reset:    { code: 'RESET_GAME', label: '게임 초기화' },
    identify: { code: 'IDENTIFY',   label: '기기 확인' },
};

// 이름 변경 시 기기로 내려보내는 내부 명령
const SET_NAME_CODE = 'SET_NAME';

// 숫자 단축키 별칭 (기존 습관 유지용)
const ALIASES = {
    '1': 'list',
    '2': 'quit',
    '3': 'start',
    '4': 'reset',
    '5': 'identify',
};

const NAME_MAX_LENGTH = 32;
const UNNAMED_PREFIX = 'UNNAMED_';

// uid 를 줄여 표기할 때 쓰는 뒷자리 수.
// Unity 쪽 VRRemoteClient.Last6 과 반드시 같아야 합니다.
const UID_SUFFIX_LENGTH = 6;

// ============================================================
// 이름 규칙 (Unity 쪽 SanitizeName 과 동일하게 맞춤)
// ============================================================
function sanitizeName(value) {
    let result = '';
    for (const ch of String(value == null ? '' : value)) {
        if (/[A-Za-z0-9_-]/.test(ch)) result += ch;
    }
    return result.slice(0, NAME_MAX_LENGTH);
}

/** uid 뒤 6자리 대문자 (Unity 쪽 Last6 과 동일) */
function uidSuffix(uid) {
    const upper = String(uid == null ? '' : uid).toUpperCase();
    if (!upper) return '';
    return upper.length > UID_SUFFIX_LENGTH ? upper.slice(-UID_SUFFIX_LENGTH) : upper;
}

function validateName(raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) return { ok: false, error: '이름을 입력하세요.' };
    if (value.length > NAME_MAX_LENGTH) return { ok: false, error: `이름은 최대 ${NAME_MAX_LENGTH}자입니다.` };
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return { ok: false, error: '영문, 숫자, _, - 만 사용할 수 있습니다.' };
    return { ok: true, name: value };
}

// ============================================================
// 매핑 테이블 (uid -> { name, model, ... })
//
// 이 테이블이 기기 이름의 유일한 원본입니다. 클라이언트가 REGISTER 에
// 실어 보내는 deviceId 는 참고용일 뿐 절대 테이블을 덮어쓰지 않습니다.
// ============================================================
const registry = new Map();

function loadRegistry() {
    let raw;
    try {
        raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[매핑 테이블] ${path.basename(DEVICES_FILE)} 이 없어 빈 목록으로 시작합니다.`);
        } else {
            console.log(`[매핑 테이블] 읽기 실패로 빈 목록으로 시작합니다: ${error.message}`);
        }
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.log(`[매핑 테이블] ${path.basename(DEVICES_FILE)} 형식이 올바르지 않아 빈 목록으로 시작합니다.`);
        return;
    }

    const rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.devices) ? parsed.devices : []);
    let skipped = 0;

    for (const row of rows) {
        if (!row || typeof row !== 'object') { skipped++; continue; }

        const uid = sanitizeName(row.uid);
        if (!uid) { skipped++; continue; }

        registry.set(uid, {
            uid,
            name: sanitizeName(row.name) || (UNNAMED_PREFIX + uidSuffix(uid)),
            model: (typeof row.model === 'string' && row.model.trim()) ? row.model.trim() : null,
            updatedAt: Number(row.updatedAt) || 0,
            lastConnectedAt: Number(row.lastConnectedAt) || null,
        });
    }

    if (skipped > 0) console.log(`[매핑 테이블] 형식이 잘못된 항목 ${skipped}건을 건너뛰었습니다.`);
    console.log(`[매핑 테이블] ${path.basename(DEVICES_FILE)} 에서 기기 ${registry.size}대를 불러왔습니다.`);
}

function saveRegistry() {
    const payload = {
        version: 1,
        devices: [...registry.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    };
    const text = JSON.stringify(payload, null, 2) + '\n';
    const tmp = DEVICES_FILE + '.tmp';

    try {
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, DEVICES_FILE);
    } catch (e) {
        // rename 이 막히는 환경에서는 직접 쓰기로 물러선다.
        try {
            fs.writeFileSync(DEVICES_FILE, text, 'utf8');
        } catch (e2) {
            console.error(`[매핑 테이블] 저장 실패: ${e2.message}`);
        }
    }
}

/** 표시이름 또는 uid 로 항목을 찾는다. */
function resolveEntry(target) {
    const key = String(target == null ? '' : target).trim();
    if (!key) return null;

    if (registry.has(key)) return registry.get(key);

    const lowered = key.toLowerCase();
    for (const entry of registry.values()) {
        if (entry.name.toLowerCase() === lowered) return entry;
    }
    return null;
}

function isNameTaken(name, exceptUid) {
    const lowered = name.toLowerCase();
    for (const entry of registry.values()) {
        if (entry.uid === exceptUid) continue;
        if (entry.name.toLowerCase() === lowered) return true;
    }
    return false;
}

/** 미할당 기기용 자동 이름. 뒤 6자리가 겹치면 접미사를 붙인다. */
function nextUnnamed(uid) {
    const base = UNNAMED_PREFIX + uidSuffix(uid);
    if (!isNameTaken(base)) return base;

    for (let i = 2; i < 100; i++) {
        const candidate = `${base}-${i}`;
        if (!isNameTaken(candidate)) return candidate;
    }
    return `${base}-${uidSuffix(String(uid) + Date.now())}`;
}

function nameOf(uid) {
    const entry = registry.get(uid);
    return entry ? entry.name : `UNKNOWN_${uidSuffix(uid)}`;
}

/** 로그 표준 표기: [이름] (uid ...ABCDEF) */
function describe(uid) {
    return `[${nameOf(uid)}] (uid ...${uidSuffix(uid)})`;
}

// ============================================================
// 서버 기동
// ============================================================
loadRegistry();

const wss = new WebSocket.Server({ port: PORT });

// uid 를 키(Key)값으로 웹소켓 객체를 보관할 주소록
const connectedDevices = new Map();

console.log('=============================================');
console.log(`[LBE 원격 제어 서버] ${PORT} 포트에서 대기 중...`);
console.log('=============================================');

wss.on('error', (err) => {
    console.error(`[서버 오류] ${err.message}`);
});

wss.on('connection', function connection(ws, req) {
    // 깔끔한 IPv4 출력을 위해 포맷팅
    const ip = String(req.socket.remoteAddress || 'unknown').replace('::ffff:', '');
    let registeredUid = null; // 현재 붙은 소켓의 기기 uid

    // 하트비트용 상태 플래그
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    console.log(`[연결됨] 새로운 기기가 접속했습니다. (IP: ${ip})`);

    ws.on('message', function incoming(raw) {
        let data;
        try {
            // ws v8+ 에서 raw 는 Buffer 이므로 문자열로 변환 후 파싱
            data = JSON.parse(raw.toString());
        } catch (error) {
            console.log(`[무시됨] JSON이 아닌 데이터 수신 (IP: ${ip})`);
            return;
        }

        if (!data || typeof data !== 'object') return;

        switch (data.type) {
            // --- 초기 등록 패킷 (uid 기준) ---
            case 'REGISTER': {
                const uid = sanitizeName(data.uid);
                if (!uid) {
                    console.log(`[등록 실패] uid가 비어 있습니다. (IP: ${ip})`);
                    return;
                }

                const model = (typeof data.model === 'string' && data.model.trim()) ? data.model.trim() : null;
                const clientLabel = sanitizeName(data.deviceId);
                const now = Date.now();

                let entry = registry.get(uid);
                if (!entry) {
                    // 처음 보는 기기 -> 미할당 이름으로 자동 등록
                    entry = {
                        uid,
                        name: nextUnnamed(uid),
                        model,
                        updatedAt: now,
                        lastConnectedAt: now,
                    };
                    registry.set(uid, entry);
                    console.log(`[신규 등록] 처음 보는 기기입니다. uid ...${uidSuffix(uid)} 에 이름 [${entry.name}] 을(를) 자동 부여했습니다.`);
                } else {
                    if (model && entry.model !== model) entry.model = model;
                    entry.lastConnectedAt = now;
                }
                entry.updatedAt = now;
                saveRegistry();

                // 클라이언트 캐시가 서버 이름과 다르면 알려만 준다. (테이블은 덮어쓰지 않음)
                if (clientLabel && clientLabel !== entry.name) {
                    console.log(`[이름 동기화] 기기가 보낸 캐시 이름 [${clientLabel}] 대신 매핑 테이블의 [${entry.name}] 을(를) 적용합니다.`);
                }

                // 같은 uid 가 이미 붙어 있으면(재접속/중복) 옛 소켓을 정리
                const prevWs = connectedDevices.get(uid);
                if (prevWs && prevWs !== ws) {
                    console.log(`[중복 감지] ${describe(uid)} 의 이전 연결을 끊습니다.`);
                    try { prevWs.close(4000, 'replaced by new connection'); } catch (e) { /* noop */ }
                }

                registeredUid = uid;
                connectedDevices.set(uid, ws);
                ws.uid = uid;
                ws.model = entry.model;

                console.log(`[등록 완료] IP: ${ip} 기기가 ${describe(uid)}${entry.model ? ` / ${entry.model}` : ''} (으)로 등록되었습니다.`);

                // 서버가 확정한 이름을 내려보낸다. 클라이언트는 이 값을 로컬에 캐시한다.
                safeSend(ws, { type: 'REGISTERED', uid, deviceId: entry.name });
                break;
            }

            // --- 클라이언트가 보내는 명령 수행 결과 ---
            case 'ACK': {
                const uid = registeredUid || sanitizeName(data.uid);
                const who = uid ? describe(uid) : `IP: ${ip}`;
                console.log(`[응답] ${who} ${data.command} -> ${data.status || 'OK'}`);
                break;
            }

            // --- 애플리케이션 레벨 핑 ---
            case 'PING': {
                safeSend(ws, { type: 'PONG' });
                break;
            }

            default: {
                const who = registeredUid ? describe(registeredUid) : `IP: ${ip}`;
                console.log(`[알 수 없는 타입] 처리할 수 없는 메시지 타입입니다: ${JSON.stringify(data.type)} (${who})`);
                break;
            }
        }
    });

    ws.on('error', (err) => {
        // 핸들러가 없으면 프로세스 전체가 죽으므로 반드시 필요
        const who = registeredUid ? describe(registeredUid) : ip;
        console.error(`[소켓 오류] ${who}: ${err.message}`);
    });

    ws.on('close', () => {
        // 중요: 같은 uid로 새 소켓이 이미 등록되었을 수 있으므로
        // "내가 등록한 소켓이 맞을 때만" 주소록에서 삭제한다.
        if (registeredUid && connectedDevices.get(registeredUid) === ws) {
            connectedDevices.delete(registeredUid);
            console.log(`[연결 해제] ${describe(registeredUid)} 접속이 끊어졌습니다. (IP: ${ip})`);
        } else if (registeredUid) {
            console.log(`[연결 해제] ${describe(registeredUid)} 의 이전(교체된) 연결이 정리되었습니다.`);
        } else {
            console.log(`[연결 해제] 미등록 기기 접속이 끊어졌습니다. (IP: ${ip})`);
        }
    });
});

// ============================================================
// 하트비트: 응답 없는 유령 소켓 강제 정리
// (Wi-Fi가 갑자기 끊긴 HMD는 close 이벤트가 오지 않아 목록에 남아있게 됨)
// ============================================================
const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            const who = ws.uid ? describe(ws.uid) : '미등록 기기';
            console.log(`[타임아웃] 응답 없는 ${who} 연결을 강제 종료합니다.`);
            return ws.terminate();
        }
        ws.isAlive = false;
        try { ws.ping(); } catch (e) { /* noop */ }
    });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeatTimer));

// ============================================================
// 전송 유틸
// ============================================================
function safeSend(ws, obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
        ws.send(JSON.stringify(obj));
        return true;
    } catch (e) {
        console.error(`[전송 실패] ${e.message}`);
        return false;
    }
}

/** uid 로 실제 소켓에 명령을 밀어넣는다. deviceId 는 SET_NAME 일 때만 사용. */
function dispatch(uid, code, deviceId) {
    const targetWs = connectedDevices.get(uid);
    if (!targetWs || targetWs.readyState !== WebSocket.OPEN) return false;

    const payload = { type: 'COMMAND', command: code };
    if (deviceId !== undefined) payload.deviceId = deviceId;

    return safeSend(targetWs, payload);
}

/** 표시이름(또는 uid)으로 지정한 한 대에 명령 전송 */
function sendCommandToOne(target, cmd) {
    const entry = resolveEntry(target);
    if (!entry) {
        console.log(`\n[오류] 매핑 테이블에 없는 기기입니다: ${target}`);
        return false;
    }

    if (!dispatch(entry.uid, cmd.code)) {
        console.log(`\n[오류] ${describe(entry.uid)} 은(는) 오프라인 상태입니다.`);
        return false;
    }

    console.log(`\n[전송 완료] ${describe(entry.uid)} 에 '${cmd.label}' 명령을 보냈습니다.`);
    return true;
}

function sendCommandToAll(cmd) {
    let count = 0;
    connectedDevices.forEach((clientWs, uid) => {
        if (dispatch(uid, cmd.code)) count++;
    });
    console.log(`\n[전송 완료] 접속된 총 ${count}대의 기기에 '${cmd.label}' 일괄 명령을 보냈습니다.`);
    return count;
}

// ============================================================
// 이름 변경
// ============================================================
function renameDevice(target, rawName) {
    const entry = resolveEntry(target);
    if (!entry) {
        console.log(`\n[오류] 대상을 찾을 수 없습니다: ${target}`);
        return false;
    }

    const check = validateName(rawName);
    if (!check.ok) {
        console.log(`\n[오류] ${check.error}`);
        return false;
    }

    if (check.name === entry.name) {
        console.log(`\n[오류] 이미 같은 이름입니다: ${check.name}`);
        return false;
    }

    if (isNameTaken(check.name, entry.uid)) {
        console.log(`\n[오류] 이미 사용 중인 이름입니다: ${check.name}`);
        return false;
    }

    const from = entry.name;
    entry.name = check.name;
    entry.updatedAt = Date.now();
    saveRegistry();

    // 접속 중이면 기기에도 알려 로컬 캐시를 갱신하게 한다.
    const notified = dispatch(entry.uid, SET_NAME_CODE, check.name);

    console.log(`\n[이름 변경] [${from}] -> [${check.name}] (uid ...${uidSuffix(entry.uid)})${notified ? ' · 기기에 전달함' : ' · 오프라인이라 접속 시 반영'}`);
    return true;
}

// ============================================================
// 콘솔 입력 인터페이스
// ============================================================
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function showMenu() {
    console.log('\n================ 명령어 안내 ================');
    console.log('list                    -> 현재 연결된 기기 명단 보기       (단축키 1)');
    console.log('quit     [대상]         -> 앱 종료                          (단축키 2)');
    console.log('start    [대상]         -> 앱 실행                          (단축키 3)');
    console.log('reset    [대상]         -> 게임 초기화                      (단축키 4)');
    console.log('identify [대상]         -> HMD 화면에 자기 이름 표시        (단축키 5)');
    console.log('rename   [대상] [새이름] -> 표시이름 변경 (매핑 테이블 갱신)');
    console.log('');
    console.log('[대상] 자리에는 표시이름 또는 uid 를 넣습니다. all 은 접속된 전체입니다.');
    console.log('  예) quit HMD_01   /   reset all   /   identify UNNAMED_A1B2C3');
    console.log('      rename UNNAMED_A1B2C3 HMD_03');
    console.log('');
    console.log('이름 규칙: 영문/숫자/_/- 만, 최대 32자. 중복 이름은 거부됩니다.');
    console.log('help                    -> 이 안내 다시 보기');
    console.log('=============================================\n');
}

function showList() {
    console.log('\n--- 현재 연결된 LBE 기기 목록 ---');

    if (connectedDevices.size === 0) {
        console.log('연결된 기기가 없습니다.');
    } else {
        connectedDevices.forEach((clientWs, uid) => {
            const entry = registry.get(uid);
            const name = entry ? entry.name : `UNKNOWN_${uidSuffix(uid)}`;
            const model = (entry && entry.model) ? entry.model : '-';
            const state = clientWs.readyState === WebSocket.OPEN ? 'ONLINE' : 'BUSY';
            const flag = name.startsWith(UNNAMED_PREFIX) ? '  <== 미할당! identify 로 실물 확인 후 rename 하세요' : '';

            console.log(`- ${name.padEnd(20)} uid ...${uidSuffix(uid)}  ${String(model).padEnd(18)} ${state}${flag}`);
        });
    }
    console.log(`총 ${connectedDevices.size}대 접속 중 / 매핑 테이블 ${registry.size}대 등록`);

    // 등록만 되어 있고 지금은 꺼져 있는 기기
    const offline = [...registry.values()].filter((e) => !connectedDevices.has(e.uid));
    if (offline.length > 0) {
        console.log(`\n[오프라인 ${offline.length}대] ${offline.map((e) => e.name).join(', ')}`);
    }
    console.log('---------------------------------');
}

showMenu();

rl.on('line', (input) => {
    const args = input.trim().split(/\s+/).filter(Boolean);
    if (args.length === 0) return;

    let command = args[0].toLowerCase();
    if (ALIASES[command]) command = ALIASES[command];

    // --- 도움말 ---
    if (command === 'help' || command === '?') {
        showMenu();
        return;
    }

    // --- 기기 목록 보기 ---
    if (command === 'list') {
        showList();
        return;
    }

    // --- 이름 변경 ---
    if (command === 'rename') {
        if (args.length < 3) {
            console.log('명령 오류: rename [현재이름|uid] [새이름] 형식으로 입력하세요. (예: rename UNNAMED_A1B2C3 HMD_03)');
            return;
        }
        renameDevice(args[1], args[2]);
        return;
    }

    // --- 실제 제어 명령 ---
    const cmd = COMMANDS[command];
    if (!cmd) {
        console.log('알 수 없는 명령입니다. help 를 입력해 명령어를 확인하세요.');
        return;
    }

    const target = args[1];
    if (!target) {
        console.log(`명령 오류: 대상을 함께 입력해주세요. (예: ${command} HMD_01  또는  ${command} all)`);
        return;
    }

    if (target.toLowerCase() === 'all') {
        sendCommandToAll(cmd);
    } else {
        sendCommandToOne(target, cmd);
    }
});

// Ctrl+C 등으로 종료할 때 소켓 정리
process.on('SIGINT', () => {
    console.log('\n[종료] 서버를 정리하고 종료합니다...');
    clearInterval(heartbeatTimer);
    wss.clients.forEach((ws) => { try { ws.close(1001, 'server shutdown'); } catch (e) { /* noop */ } });
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
});
