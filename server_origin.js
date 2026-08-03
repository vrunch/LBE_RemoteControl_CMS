const WebSocket = require('ws');
const readline = require('readline');

// ============================================================
// 설정
// ============================================================
const PORT = 7485;
const HEARTBEAT_INTERVAL = 10000; // 10초마다 생존 확인 (죽은 소켓 청소용)

// 서버 <-> 클라이언트 공통 명령 규격
// Unity 쪽 VRRemoteClient.Commands 의 문자열과 반드시 일치해야 합니다.
const COMMANDS = {
    quit:  { code: 'QUIT_APP',   label: '앱 종료' },
    start: { code: 'LAUNCH_APP', label: '앱 실행' },
    reset: { code: 'RESET_GAME', label: '게임 초기화' },
};

// 숫자 단축키 별칭 (기존 습관 유지용)
const ALIASES = {
    '1': 'list',
    '2': 'quit',
    '3': 'start',
    '4': 'reset',
};

// ============================================================
// 서버 기동
// ============================================================
const wss = new WebSocket.Server({ port: PORT });

// 기기 ID를 키(Key)값으로 웹소켓 객체를 보관할 주소록
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
    let registeredId = null; // 현재 붙은 소켓의 고유 기기 이름

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
            // --- 초기 등록 패킷 ---
            case 'REGISTER': {
                const newId = (data.deviceId || '').trim();
                if (!newId) {
                    console.log(`[등록 실패] deviceId가 비어 있습니다. (IP: ${ip})`);
                    return;
                }

                // 같은 ID가 이미 붙어 있으면(재접속/중복 기기) 옛 소켓을 정리
                const prevWs = connectedDevices.get(newId);
                if (prevWs && prevWs !== ws) {
                    console.log(`[중복 감지] ID [${newId}] 의 이전 연결을 끊습니다.`);
                    try { prevWs.close(4000, 'replaced by new connection'); } catch (e) { /* noop */ }
                }

                registeredId = newId;
                connectedDevices.set(registeredId, ws);
                ws.deviceId = registeredId;

                console.log(`[등록 완료] IP: ${ip} 기기가 고유 ID [${registeredId}] (으)로 등록되었습니다.`);
                safeSend(ws, { type: 'REGISTERED', deviceId: registeredId });
                break;
            }

            // --- 클라이언트가 보내는 명령 수행 결과 ---
            case 'ACK': {
                console.log(`[응답] [${registeredId || ip}] ${data.command} -> ${data.status || 'OK'}`);
                break;
            }

            // --- 애플리케이션 레벨 핑 ---
            case 'PING': {
                safeSend(ws, { type: 'PONG' });
                break;
            }

            default:
                break;
        }
    });

    ws.on('error', (err) => {
        // 핸들러가 없으면 프로세스 전체가 죽으므로 반드시 필요
        console.error(`[소켓 오류] ${registeredId || ip}: ${err.message}`);
    });

    ws.on('close', () => {
        // 중요: 같은 ID로 새 소켓이 이미 등록되었을 수 있으므로
        // "내가 등록한 소켓이 맞을 때만" 주소록에서 삭제한다.
        if (registeredId && connectedDevices.get(registeredId) === ws) {
            connectedDevices.delete(registeredId);
            console.log(`[연결 해제] 기기 [${registeredId}] 접속이 끊어졌습니다. (IP: ${ip})`);
        } else if (registeredId) {
            console.log(`[연결 해제] 기기 [${registeredId}] 의 이전(교체된) 연결이 정리되었습니다.`);
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
            console.log(`[타임아웃] 응답 없는 기기 [${ws.deviceId || '미등록'}] 연결을 강제 종료합니다.`);
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

function sendCommandToOne(targetId, cmd) {
    const targetWs = connectedDevices.get(targetId);
    if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
        console.log(`\n[오류] 기기를 찾을 수 없거나 오프라인 상태입니다: ${targetId}`);
        return false;
    }
    const ok = safeSend(targetWs, { type: 'COMMAND', command: cmd.code });
    if (ok) console.log(`\n[전송 완료] 기기 [${targetId}] 에 '${cmd.label}' 명령을 보냈습니다.`);
    return ok;
}

function sendCommandToAll(cmd) {
    let count = 0;
    connectedDevices.forEach((clientWs, id) => {
        if (safeSend(clientWs, { type: 'COMMAND', command: cmd.code })) count++;
    });
    console.log(`\n[전송 완료] 접속된 총 ${count}대의 기기에 '${cmd.label}' 일괄 명령을 보냈습니다.`);
    return count;
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
    console.log('list           -> 현재 연결된 기기 명단 보기          (단축키 1)');
    console.log('quit  [대상]   -> 앱 종료                             (단축키 2)');
    console.log('start [대상]   -> 앱 실행                             (단축키 3)');
    console.log('reset [대상]   -> 게임 초기화                         (단축키 4)');
    console.log('');
    console.log('[대상] 자리에는 기기 ID 또는 all 을 넣습니다.');
    console.log('  예) quit HMD_01   /   reset all   /   3 HMD_02');
    console.log('help           -> 이 안내 다시 보기');
    console.log('=============================================\n');
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
        console.log('\n--- 현재 연결된 LBE 기기 목록 ---');
        if (connectedDevices.size === 0) {
            console.log('연결된 기기가 없습니다.');
        } else {
            connectedDevices.forEach((clientWs, id) => {
                const state = clientWs.readyState === WebSocket.OPEN ? 'ONLINE' : 'BUSY';
                console.log(`- 기기 ID: ${id}  (${state})`);
            });
        }
        console.log(`총 ${connectedDevices.size}대`);
        console.log('---------------------------------');
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