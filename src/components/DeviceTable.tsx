"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  IconEye,
  IconHeadset,
  IconPencil,
  IconPlay,
  IconPower,
  IconRefresh,
  IconTrash,
} from "@/components/icons";
import { useLbe, useNow } from "@/components/LbeProvider";
import { RenameDialog } from "@/components/RenameDialog";
import { TeamStartDialog } from "@/components/TeamStartDialog";
import { Badge, Button, EmptyState, Panel, PanelHeader, StatusDot } from "@/components/ui";
import { batteryTone, formatDuration, formatRelative, latencyTone } from "@/lib/format";
import { COMMANDS, commandLabelByCode, uidSuffix, type CommandKey, type DeviceView } from "@/lib/protocol";

const ROW_ACTIONS = [
  { key: "identify" as const, Icon: IconEye, variant: "primary" as const },
  { key: "start" as const, Icon: IconPlay, variant: "positive" as const },
  { key: "reset" as const, Icon: IconRefresh, variant: "warning" as const },
  { key: "quit" as const, Icon: IconPower, variant: "danger" as const },
];

// ============================================================
// 체크박스
// ============================================================
function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span className="relative inline-grid size-4 place-items-center align-middle">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="peer focus-ring size-4 cursor-pointer appearance-none rounded-[5px] border border-base-700 bg-base-850 transition-colors checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent hover:border-base-500"
      />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute size-2.5 text-base-950 opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      >
        <path d="m4 12.5 5 5L20 6.5" />
      </svg>
      <span className="pointer-events-none absolute h-[2px] w-2 rounded-full bg-base-950 opacity-0 peer-indeterminate:opacity-100" />
    </span>
  );
}

// ============================================================
// 기기 테이블
// ============================================================
export function DeviceTable() {
  const { snapshot, sendCommand, forgetDevice, sending, connected } = useLbe();
  const now = useNow();

  const devices = useMemo(() => snapshot?.devices ?? [], [snapshot]);
  const onlineDevices = useMemo(() => devices.filter((d) => d.status === "online"), [devices]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ command: CommandKey; targets: string[] } | null>(null);
  const [renaming, setRenaming] = useState<DeviceView | null>(null);
  const [forgetting, setForgetting] = useState<DeviceView | null>(null);
  /** 팀 세션 시작(QR 대체) 창 열림 여부. 열 때마다 마운트해 입력 상태를 새로 시작한다. */
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);

  // 선택은 uid 로 들고 있는다. 이름은 언제든 바뀔 수 있기 때문.
  // 목록에서 사라진 기기와 오프라인 기기는 렌더 시점에 걸러낸다.
  const selected = useMemo(() => {
    if (picked.size === 0) return picked;
    const selectable = new Set(onlineDevices.map((d) => d.uid));
    const next = new Set([...picked].filter((uid) => selectable.has(uid)));
    return next.size === picked.size ? picked : next;
  }, [picked, onlineDevices]);

  /** 명령은 표시이름으로 보낸다 (서버가 매핑 테이블에서 uid 로 역해석) */
  const selectedNames = useMemo(
    () => onlineDevices.filter((d) => selected.has(d.uid)).map((d) => d.name),
    [onlineDevices, selected],
  );

  const allSelected = onlineDevices.length > 0 && selected.size === onlineDevices.length;

  const toggleAll = () => {
    setPicked(allSelected ? new Set() : new Set(onlineDevices.map((d) => d.uid)));
  };

  const toggleOne = (uid: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const run = (command: CommandKey, targets: string[]) => {
    void sendCommand(command, targets);
  };

  /** 여러 대를 한 번에 건드리는 파괴적 명령은 확인을 거친다. */
  const runSelected = (command: CommandKey, targets: string[]) => {
    if (command !== "start" && command !== "identify" && targets.length > 1) {
      setConfirm({ command, targets });
      return;
    }
    run(command, targets);
  };

  const unnamedCount = devices.filter((d) => d.unnamed).length;

  return (
    <>
      <Panel>
        <PanelHeader
          title="기기 목록"
          desc={
            devices.length > 0
              ? `등록 ${devices.length}대 · 온라인 ${onlineDevices.length}대${
                  unnamedCount > 0 ? ` · 미할당 ${unnamedCount}대` : ""
                }${selected.size > 0 ? ` · 선택 ${selected.size}대` : ""}`
              : "등록된 기기가 없습니다"
          }
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              {selected.size > 0 ? (
                <>
                  <span className="mr-1 hidden text-[11px] text-base-500 sm:inline">
                    선택 {selected.size}대에
                  </span>
                  {ROW_ACTIONS.map(({ key, Icon, variant }) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={variant}
                      disabled={sending || !connected}
                      onClick={() => runSelected(key, selectedNames)}
                    >
                      <Icon className="size-3.5" />
                      {COMMANDS[key].label}
                    </Button>
                  ))}
                  <span className="mx-0.5 h-4 w-px bg-base-800" />
                </>
              ) : null}
              {/* 팀 세션 시작 (QR 스캔 대체): 팀 ID/인원수 입력 + 대상 기기 선택 팝업 */}
              <Button
                size="sm"
                variant="primary"
                disabled={sending || !connected || onlineDevices.length === 0}
                title="선택한 기기들에 팀 ID/인원수를 보내 게임 접속을 시작합니다 (QR 스캔 대체)"
                onClick={() => setTeamDialogOpen(true)}
              >
                <IconPlay className="size-3.5" />
                팀 세션 시작
              </Button>
            </div>
          }
        />

        {devices.length === 0 ? (
          <EmptyState
            icon={<IconHeadset className="size-8" />}
            title="등록된 기기가 없습니다"
            desc="HMD에서 앱을 실행하면 uid 기준으로 자동 등록되고, UNNAMED_ 이름이 임시로 부여됩니다."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] border-collapse text-left">
              <thead>
                <tr className="border-b border-base-800 text-[11px] font-medium tracking-wide text-base-500">
                  <th className="w-10 py-2.5 pl-5">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={selected.size > 0 && !allSelected}
                      onChange={toggleAll}
                      label="온라인 기기 전체 선택"
                    />
                  </th>
                  <th className="py-2.5 pr-3 font-medium">기기</th>
                  <th className="py-2.5 pr-3 font-medium">상태</th>
                  <th className="py-2.5 pr-3 font-medium">모델</th>
                  <th className="py-2.5 pr-3 font-medium">배터리</th>
                  <th className="py-2.5 pr-3 font-medium">지연</th>
                  <th className="py-2.5 pr-3 font-medium">최근 명령</th>
                  <th className="py-2.5 pr-3 font-medium">최근 응답</th>
                  <th className="py-2.5 pr-3 font-medium">접속 시간</th>
                  <th className="py-2.5 pr-5 text-right font-medium">제어</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <DeviceRow
                    key={device.uid}
                    device={device}
                    now={now}
                    checked={selected.has(device.uid)}
                    onToggle={() => toggleOne(device.uid)}
                    onCommand={(command) => run(command, [device.name])}
                    onRename={() => setRenaming(device)}
                    onForget={() => setForgetting(device)}
                    disabled={sending || !connected}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <RenameDialog device={renaming} onClose={() => setRenaming(null)} />

      {teamDialogOpen ? (
        <TeamStartDialog
          devices={onlineDevices}
          initialSelected={[...selected]}
          onClose={() => setTeamDialogOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `${COMMANDS[confirm.command].label} - ${confirm.targets.length}대 일괄 실행` : ""}
        desc={
          confirm
            ? `선택한 ${confirm.targets.length}대에 '${COMMANDS[confirm.command].label}' 명령을 보냅니다. 진행 중인 세션이 중단될 수 있습니다.`
            : undefined
        }
        confirmLabel={confirm ? COMMANDS[confirm.command].label : ""}
        tone={confirm?.command === "quit" ? "danger" : "warning"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) run(confirm.command, confirm.targets);
          setConfirm(null);
        }}
      />

      <ConfirmDialog
        open={forgetting !== null}
        title={forgetting ? `[${forgetting.name}] 목록에서 제거` : ""}
        desc={
          forgetting
            ? `매핑 테이블에서 이 기기를 지웁니다. 다시 접속하면 uid 기준으로 재등록되며 UNNAMED_ 이름이 새로 붙습니다.`
            : undefined
        }
        confirmLabel="제거"
        tone="danger"
        onCancel={() => setForgetting(null)}
        onConfirm={() => {
          if (forgetting) void forgetDevice(forgetting.uid);
          setForgetting(null);
        }}
      />
    </>
  );
}

// ============================================================
// 행
// ============================================================
function DeviceRow({
  device,
  now,
  checked,
  onToggle,
  onCommand,
  onRename,
  onForget,
  disabled,
}: {
  device: DeviceView;
  now: number;
  checked: boolean;
  onToggle: () => void;
  onCommand: (command: CommandKey) => void;
  onRename: () => void;
  onForget: () => void;
  disabled: boolean;
}) {
  const online = device.status === "online";
  const tone = latencyTone(device.latencyMs);
  const batTone = batteryTone(device.battery);
  const ackOk = device.lastAck ? device.lastAck.toUpperCase() === "OK" : null;

  return (
    <tr
      className={`border-b border-base-800/70 text-[13px] transition-colors last:border-b-0 ${
        checked ? "bg-accent/[0.04]" : "hover:bg-base-850/60"
      } ${online ? "" : "opacity-60"}`}
    >
      <td className="py-3 pl-5">
        {online ? (
          <Checkbox checked={checked} onChange={onToggle} label={`${device.name} 선택`} />
        ) : (
          <span className="inline-block size-4" />
        )}
      </td>

      {/* 기기: 표시이름 + uid 뒤 6자리 */}
      <td className="py-3 pr-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`grid size-7 shrink-0 place-items-center rounded-md border ${
              device.unnamed
                ? "border-warn/30 bg-warn/10 text-warn"
                : "border-base-750 bg-base-850 text-base-400"
            }`}
          >
            <IconHeadset className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[13px] font-medium text-base-100">{device.name}</span>
              {device.unnamed ? <Badge tone="warn">미할당</Badge> : null}
              <button
                type="button"
                onClick={onRename}
                title={`${device.name} 이름 변경`}
                className="focus-ring grid size-5 shrink-0 place-items-center rounded text-base-500 transition-colors hover:bg-base-800 hover:text-base-100"
              >
                <IconPencil className="size-3" />
              </button>
            </div>
            <span className="font-mono text-[11px] text-base-500">
              uid ...{uidSuffix(device.uid)}
              {device.ip ? ` · ${device.ip}` : ""}
            </span>
          </div>
        </div>
      </td>

      <td className="py-3 pr-3">
        <span className="inline-flex items-center gap-2">
          <StatusDot tone={online ? "ok" : "muted"} pulse={online} />
          <span className={`text-[12px] font-medium ${online ? "text-ok" : "text-base-500"}`}>
            {online ? "온라인" : "오프라인"}
          </span>
        </span>
      </td>

      <td className="py-3 pr-3">
        <span className="text-[12px] text-base-400">{device.model ?? "-"}</span>
      </td>

      {/* 배터리: 기기의 STATUS 보고(변화 이벤트 + 주기 안전망) 기반.
          새로고침 버튼은 GET_STATUS 명령으로 즉시 1회 보고를 요청한다. */}
      <td className="tabular py-3 pr-3">
        <span className="inline-flex items-center gap-1">
          {device.battery === null ? (
            <span className="text-[12px] text-base-500">{online ? "보고 대기" : "-"}</span>
          ) : (
            <span
              className={`text-[12px] font-medium ${
                batTone === "ok" ? "text-ok" : batTone === "warn" ? "text-warn" : "text-danger"
              }`}
              title={
                device.batteryAt ? `마지막 보고: ${formatRelative(device.batteryAt, now)}` : undefined
              }
            >
              {device.battery}%{device.batteryCharging === "charging" ? " ⚡" : ""}
            </span>
          )}
          {online ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCommand("status")}
              title={`${device.name} 배터리 상태 갱신`}
              className="focus-ring grid size-5 shrink-0 place-items-center rounded text-base-500 transition-colors hover:bg-base-800 hover:text-base-100 disabled:pointer-events-none disabled:opacity-35"
            >
              <IconRefresh className="size-3" />
            </button>
          ) : null}
        </span>
      </td>

      <td className="tabular py-3 pr-3">
        {device.latencyMs === null ? (
          <span className="text-[12px] text-base-500">{online ? "측정 중" : "-"}</span>
        ) : (
          <span
            className={`text-[12px] font-medium ${
              tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-danger"
            }`}
          >
            {device.latencyMs}ms
          </span>
        )}
      </td>

      <td className="py-3 pr-3">
        {device.lastCommand ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-base-200">
              {commandLabelByCode(device.lastCommand)}
            </span>
            <span className="text-[11px] text-base-500">
              {formatRelative(device.lastCommandAt, now)}
            </span>
          </div>
        ) : (
          <span className="text-[12px] text-base-500">-</span>
        )}
      </td>

      <td className="py-3 pr-3">
        {device.lastAck ? (
          <div className="flex flex-col items-start gap-1">
            <Badge tone={ackOk ? "ok" : "warn"}>{device.lastAck}</Badge>
            <span className="text-[11px] text-base-500">{formatRelative(device.lastAckAt, now)}</span>
          </div>
        ) : (
          <span className="text-[12px] text-base-500">-</span>
        )}
      </td>

      <td className="tabular py-3 pr-3 text-[12px] text-base-400">
        {online && device.connectedAt
          ? formatDuration(now - device.connectedAt)
          : device.lastSeenAt
            ? `${formatRelative(device.lastSeenAt, now)} 접속`
            : "-"}
      </td>

      <td className="py-3 pr-5">
        <div className="flex items-center justify-end gap-1.5">
          {ROW_ACTIONS.map(({ key, Icon, variant }) => (
            <Button
              key={key}
              size="sm"
              variant={variant}
              disabled={disabled || !online}
              title={`${device.name} - ${COMMANDS[key].label}`}
              onClick={() => onCommand(key)}
            >
              <Icon className="size-3.5" />
            </Button>
          ))}

          {/* 오프라인 기기만 매핑 테이블에서 지울 수 있다. */}
          <Button
            size="sm"
            variant="ghost"
            disabled={online}
            title={online ? "접속 중인 기기는 제거할 수 없습니다" : `${device.name} 목록에서 제거`}
            onClick={onForget}
            className="ml-1"
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
