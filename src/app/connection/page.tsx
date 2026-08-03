"use client";

import { useState, useSyncExternalStore } from "react";

import { IconCheck, IconCopy } from "@/components/icons";
import { useLbe } from "@/components/LbeProvider";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { COMMANDS, COMMAND_KEYS, NAME_MAX_LENGTH, SET_NAME_CODE } from "@/lib/protocol";

/** 서버 렌더 때는 알 수 없는 값이므로 하이드레이션 이후에 채운다. */
const subscribeNoop = () => () => {};

export default function ConnectionPage() {
  const { snapshot } = useLbe();

  // 대시보드에 접속한 주소를 그대로 안내해야 기기가 찾아올 수 있다.
  const host = useSyncExternalStore(
    subscribeNoop,
    () => window.location.hostname,
    () => null,
  );

  const port = snapshot?.port ?? 7485;
  const endpoint = host ? `ws://${host}:${port}` : "";

  return (
    <>
      <Panel>
        <PanelHeader
          title="웹소켓 엔드포인트"
          desc="Unity 클라이언트의 serverUrl 에 넣을 주소입니다. HMD와 서버가 같은 네트워크에 있어야 합니다."
          right={
            <Badge tone={snapshot?.error ? "danger" : "ok"}>
              {snapshot?.error ? "수신 실패" : "수신 중"}
            </Badge>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <CopyField label="접속 주소" value={endpoint} placeholder="주소를 불러오는 중..." />
          <CopyField label="매핑 테이블 파일" value={snapshot?.registryPath ?? ""} placeholder="확인 중..." />
        </div>
        {snapshot?.error ? (
          <p className="border-t border-base-800 px-4 py-3 text-xs leading-relaxed text-danger/85">
            {snapshot.error}
          </p>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader
          title="기기 식별 체계"
          desc="이름이 아니라 uid 가 기기를 가리키는 유일한 기준입니다."
        />
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          <InfoCard
            title="uid"
            body="기기 하드웨어 고유값(SystemInfo.deviceUniqueIdentifier). 소켓 관리 키이자 매핑 테이블의 기본키입니다. 앱을 지웠다 깔아도 유지됩니다."
          />
          <InfoCard
            title="표시이름"
            body="운영자가 읽는 별칭. 서버의 매핑 테이블이 소유하며, 클라이언트가 REGISTER 에 실어 보내는 deviceId 는 참고용일 뿐 테이블을 덮어쓰지 못합니다."
          />
          <InfoCard
            title="UNNAMED_"
            body="처음 보는 uid 는 UNNAMED_ + uid 뒤 6자리로 자동 등록됩니다. 기기 확인(IDENTIFY)으로 실물을 찾은 뒤 이름을 지정하세요."
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="명령 코드"
          desc="Unity 쪽 VRRemoteClient.Commands 문자열과 반드시 일치해야 합니다."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-left">
            <thead>
              <tr className="border-b border-base-800 text-[11px] font-medium text-base-500">
                <th className="py-2.5 pr-3 pl-5 font-medium">명령</th>
                <th className="py-2.5 pr-3 font-medium">전송 코드</th>
                <th className="py-2.5 pr-5 font-medium">설명</th>
              </tr>
            </thead>
            <tbody>
              {COMMAND_KEYS.map((key) => {
                const cmd = COMMANDS[key];
                return (
                  <tr key={key} className="border-b border-base-800/70 text-[13px]">
                    <td className="py-3 pr-3 pl-5">
                      <Badge tone={TONE_MAP[cmd.tone]}>{cmd.label}</Badge>
                    </td>
                    <td className="py-3 pr-3 font-mono text-[12px] text-base-100">{cmd.code}</td>
                    <td className="py-3 pr-5 text-[12px] text-base-400">{DESCRIPTIONS[key]}</td>
                  </tr>
                );
              })}
              <tr className="text-[13px]">
                <td className="py-3 pr-3 pl-5">
                  <Badge tone="muted">이름 변경</Badge>
                </td>
                <td className="py-3 pr-3 font-mono text-[12px] text-base-100">{SET_NAME_CODE}</td>
                <td className="py-3 pr-5 text-[12px] text-base-400">
                  서버가 확정한 새 이름을 기기에 알립니다. 운영자가 직접 고르는 명령이 아니라 이름 변경 시
                  자동으로 전송됩니다.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-base-800 px-4 py-3 text-[11px] leading-relaxed text-base-500">
          이름 규칙: 영문, 숫자, <code className="rounded bg-base-850 px-1 font-mono">_</code>,{" "}
          <code className="rounded bg-base-850 px-1 font-mono">-</code> 만 허용하며 최대 {NAME_MAX_LENGTH}
          자입니다. 중복된 이름은 거부됩니다.
        </p>
      </Panel>

      <Panel>
        <PanelHeader title="통신 규격" desc="모든 패킷은 평평한 JSON 하나로 주고받습니다." />
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <CodeBlock
            title="1. 기기 등록 (기기 → 서버)"
            desc="uid 가 필수입니다. deviceId 는 기기가 캐시해 둔 이름으로 참고용입니다."
            code={`{
  "type": "REGISTER",
  "uid": "a1b2c3d4e5f6",
  "deviceId": "HMD_01",
  "model": "Quest 3"
}`}
          />
          <CodeBlock
            title="2. 등록 확인 (서버 → 기기)"
            desc="서버 매핑 테이블이 확정한 이름을 내려줍니다. 기기는 이 이름을 로컬에 캐시합니다."
            code={`{
  "type": "REGISTERED",
  "uid": "a1b2c3d4e5f6",
  "deviceId": "HMD_01"
}`}
          />
          <CodeBlock
            title="3. 명령 (서버 → 기기)"
            desc="SET_NAME 일 때만 deviceId 에 새 이름이 함께 실립니다."
            code={`{ "type": "COMMAND", "command": "RESET_GAME" }

{ "type": "COMMAND", "command": "SET_NAME",
  "deviceId": "HMD_02" }`}
          />
          <CodeBlock
            title="4. 수행 결과 (기기 → 서버)"
            desc="명령을 처리한 뒤 보내면 '최근 응답' 칸에 표시됩니다."
            code={`{
  "type": "ACK",
  "uid": "a1b2c3d4e5f6",
  "deviceId": "HMD_01",
  "command": "RESET_GAME",
  "status": "OK"
}`}
          />
        </div>
        <p className="border-t border-base-800 px-4 py-3 text-[11px] leading-relaxed text-base-500">
          서버는 10초마다 웹소켓 ping 을 보내 생존을 확인합니다. 응답이 없는 기기는 자동으로 목록에서
          제거되므로, 클라이언트는 pong 을 그대로 회신해야 합니다. 애플리케이션 레벨로{" "}
          <code className="rounded bg-base-850 px-1 py-0.5 font-mono text-base-300">
            {`{ "type": "PING" }`}
          </code>{" "}
          을 보내면 서버가{" "}
          <code className="rounded bg-base-850 px-1 py-0.5 font-mono text-base-300">
            {`{ "type": "PONG" }`}
          </code>{" "}
          으로 답합니다. 같은 uid 로 새 소켓이 붙으면 이전 연결은 즉시 끊깁니다.
        </p>
      </Panel>
    </>
  );
}

const TONE_MAP = {
  info: "accent",
  positive: "ok",
  warning: "warn",
  danger: "danger",
} as const;

const DESCRIPTIONS: Record<(typeof COMMAND_KEYS)[number], string> = {
  identify: "HMD 화면에 자기 이름과 uid 뒤 6자리를 띄웁니다. 미할당 기기의 실물을 찾을 때 사용합니다.",
  start: "기기에서 LBE 앱을 실행합니다.",
  reset: "진행 중인 게임을 처음 상태로 되돌립니다.",
  quit: "실행 중인 앱을 종료합니다.",
};

// ============================================================
// 설명 카드
// ============================================================
function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-base-800 bg-base-850 px-3.5 py-3">
      <p className="font-mono text-[12px] font-semibold text-accent">{title}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-base-400">{body}</p>
    </div>
  );
}

// ============================================================
// 복사 가능한 값 필드
// ============================================================
function CopyField({
  label,
  value,
  placeholder,
}: {
  label: string;
  value: string;
  placeholder?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없으면(비 HTTPS 환경 등) 조용히 무시
    }
  };

  return (
    <div className="rounded-lg border border-base-800 bg-base-850 px-3.5 py-3">
      <p className="text-[11px] font-medium text-base-500">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-base-100" title={value}>
          {value || placeholder}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!value}
          title="복사"
          className="focus-ring grid size-7 shrink-0 place-items-center rounded-md border border-base-750 text-base-400 transition-colors hover:bg-base-800 hover:text-base-100 disabled:opacity-40"
        >
          {copied ? <IconCheck className="size-3.5 text-ok" /> : <IconCopy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 코드 블록
// ============================================================
function CodeBlock({ title, desc, code }: { title: string; desc: string; code: string }) {
  return (
    <div className="rounded-lg border border-base-800 bg-base-850">
      <div className="border-b border-base-800 px-3.5 py-2.5">
        <p className="text-[12px] font-semibold text-base-100">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-base-500">{desc}</p>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3">
        <code className="font-mono text-[12px] whitespace-pre text-accent">{code}</code>
      </pre>
    </div>
  );
}
