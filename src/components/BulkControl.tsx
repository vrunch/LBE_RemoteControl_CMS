"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconEye, IconPlay, IconPower, IconRefresh } from "@/components/icons";
import { useLbe } from "@/components/LbeProvider";
import { Panel, PanelHeader } from "@/components/ui";
import { COMMANDS, type CommandKey } from "@/lib/protocol";

const ACTIONS = [
  {
    key: "identify" as const,
    Icon: IconEye,
    desc: "각 HMD 화면에 자기 이름을 띄웁니다",
    className: "border-accent/25 bg-accent/[0.07] text-accent hover:bg-accent/15 hover:border-accent/45",
  },
  {
    key: "start" as const,
    Icon: IconPlay,
    desc: "모든 기기에서 앱을 실행합니다",
    className: "border-ok/25 bg-ok/[0.07] text-ok hover:bg-ok/15 hover:border-ok/45",
  },
  {
    key: "reset" as const,
    Icon: IconRefresh,
    desc: "진행 중인 게임을 처음 상태로 되돌립니다",
    className: "border-warn/25 bg-warn/[0.07] text-warn hover:bg-warn/15 hover:border-warn/45",
  },
  {
    key: "quit" as const,
    Icon: IconPower,
    desc: "모든 기기의 앱을 종료합니다",
    className: "border-danger/25 bg-danger/[0.07] text-danger hover:bg-danger/15 hover:border-danger/45",
  },
];

/** 접속된 전 기기를 한 번에 제어하는 패널 */
export function BulkControl() {
  const { snapshot, sendCommand, sending, connected } = useLbe();
  const [confirm, setConfirm] = useState<CommandKey | null>(null);

  const online = snapshot?.devices.filter((d) => d.status === "online").length ?? 0;
  const disabled = sending || !connected || online === 0;

  const request = (command: CommandKey) => {
    // 기기 확인/앱 실행은 되돌리기 쉬우므로 바로, 나머지는 확인 후 전송
    if (command === "start" || command === "identify") void sendCommand(command, "all");
    else setConfirm(command);
  };

  return (
    <>
      <Panel>
        <PanelHeader
          title="일괄 제어"
          desc={
            online > 0
              ? `접속된 ${online}대 전체에 명령을 보냅니다`
              : "접속된 기기가 없어 전송할 수 없습니다"
          }
        />
        <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {ACTIONS.map(({ key, Icon, desc, className }) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => request(key)}
              className={`focus-ring flex flex-col items-start gap-2 rounded-lg border px-4 py-3.5 text-left transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35 ${className}`}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold">
                <Icon className="size-4" />
                {COMMANDS[key].label}
              </span>
              <span className="text-[11px] leading-snug text-base-400">{desc}</span>
            </button>
          ))}
        </div>
      </Panel>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `전체 ${online}대에 '${COMMANDS[confirm].label}' 실행` : ""}
        desc={
          confirm
            ? "현재 접속된 모든 기기에 명령이 전송됩니다. 운영 중인 세션이 있다면 즉시 중단됩니다."
            : undefined
        }
        confirmLabel={confirm ? `${online}대에 전송` : ""}
        tone={confirm === "quit" ? "danger" : "warning"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void sendCommand(confirm, "all");
          setConfirm(null);
        }}
      />
    </>
  );
}
