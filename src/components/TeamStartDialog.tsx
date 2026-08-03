"use client";

import { useEffect, useMemo, useState } from "react";

import { IconPlay } from "@/components/icons";
import { useLbe } from "@/components/LbeProvider";
import { Badge, Button } from "@/components/ui";
import {
  TEAM_COUNT_MAX,
  TEAM_COUNT_MIN,
  TEAM_ID_MAX,
  TEAM_ID_MIN,
  uidSuffix,
  type DeviceView,
} from "@/lib/protocol";

/**
 * 팀 세션 시작 창 (기존 QR 스캔 대체).
 * 팀 ID / 인원수를 입력하고, 적용할 온라인 기기를 골라 START_TEAM 명령을 보낸다.
 * 대상은 uid 로 전송한다 (이름이 도중에 바뀌어도 엉뚱한 기기를 건드리지 않도록).
 */
export function TeamStartDialog({
  devices,
  initialSelected,
  onClose,
}: {
  /** 선택 후보 (온라인 기기만) */
  devices: DeviceView[];
  /** 미리 체크해 둘 uid 목록 (기기 목록에서 선택돼 있던 기기) */
  initialSelected: string[];
  onClose: () => void;
}) {
  const { startTeam, sending } = useLbe();

  const [teamId, setTeamId] = useState("1");
  const [teamCount, setTeamCount] = useState(String(Math.max(TEAM_COUNT_MIN, initialSelected.length || 2)));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialSelected));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 목록이 실시간 갱신되므로, 도중에 오프라인이 된 기기는 선택에서 걸러낸다.
  const selected = useMemo(() => {
    const online = new Set(devices.map((d) => d.uid));
    return new Set([...picked].filter((uid) => online.has(uid)));
  }, [picked, devices]);

  const allSelected = devices.length > 0 && selected.size === devices.length;

  const toggleAll = () => {
    setPicked(allSelected ? new Set() : new Set(devices.map((d) => d.uid)));
  };

  const toggleOne = (uid: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const validate = (): { id: number; count: number } | null => {
    const id = Number(teamId);
    if (!Number.isInteger(id) || id < TEAM_ID_MIN || id > TEAM_ID_MAX) {
      setError(`팀 ID는 ${TEAM_ID_MIN}~${TEAM_ID_MAX} 사이의 정수여야 합니다.`);
      return null;
    }
    const count = Number(teamCount);
    if (!Number.isInteger(count) || count < TEAM_COUNT_MIN || count > TEAM_COUNT_MAX) {
      setError(`인원수는 ${TEAM_COUNT_MIN}~${TEAM_COUNT_MAX} 사이의 정수여야 합니다.`);
      return null;
    }
    if (selected.size === 0) {
      setError("적용할 기기를 1대 이상 선택하세요.");
      return null;
    }
    return { id, count };
  };

  const submit = async () => {
    const checked = validate();
    if (!checked) return;

    setBusy(true);
    setError(null);

    const result = await startTeam(checked.id, checked.count, [...selected]);
    setBusy(false);

    if (result?.ok) onClose();
    else if (result?.error) setError(result.error);
  };

  const inputClass =
    "focus-ring h-9 w-full rounded-lg border border-base-800 bg-base-850 px-3 font-mono text-[13px] text-base-100 placeholder:font-sans placeholder:text-base-500";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="팀 세션 시작"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-md rounded-xl border border-base-800 bg-base-880 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-ok/30 bg-ok/10 text-ok">
            <IconPlay className="size-4" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold text-base-100">팀 세션 시작</h3>
            <p className="mt-1 text-xs leading-relaxed text-base-400">
              QR 스캔 대신 선택한 기기들에 팀 ID와 인원수를 보내 게임 접속을 시작합니다.
            </p>
          </div>
        </div>

        {/* 팀 ID / 인원수 */}
        <div className="grid grid-cols-2 gap-3 px-5 pt-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-base-400">
              팀 ID ({TEAM_ID_MIN}~{TEAM_ID_MAX})
            </span>
            <input
              value={teamId}
              autoFocus
              type="number"
              min={TEAM_ID_MIN}
              max={TEAM_ID_MAX}
              step={1}
              onChange={(event) => {
                setTeamId(event.target.value);
                setError(null);
              }}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-base-400">
              팀 인원수 ({TEAM_COUNT_MIN}~{TEAM_COUNT_MAX})
            </span>
            <input
              value={teamCount}
              type="number"
              min={TEAM_COUNT_MIN}
              max={TEAM_COUNT_MAX}
              step={1}
              onChange={(event) => {
                setTeamCount(event.target.value);
                setError(null);
              }}
              className={inputClass}
            />
          </label>
        </div>

        {/* 대상 기기 선택 */}
        <div className="px-5 pt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-base-400">
              적용할 기기 ({selected.size}/{devices.length}대 선택)
            </span>
            {devices.length > 0 ? (
              <button
                type="button"
                onClick={toggleAll}
                className="focus-ring rounded px-1.5 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent/10"
              >
                {allSelected ? "전체 해제" : "전체 선택"}
              </button>
            ) : null}
          </div>

          <div className="max-h-52 overflow-y-auto rounded-lg border border-base-800 bg-base-850/50">
            {devices.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-base-500">
                접속(온라인) 중인 기기가 없습니다.
              </p>
            ) : (
              devices.map((device) => {
                const checked = selected.has(device.uid);
                return (
                  <label
                    key={device.uid}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-base-800/60 px-3 py-2 transition-colors last:border-b-0 hover:bg-base-800/50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(device.uid)}
                      className="focus-ring size-4 cursor-pointer appearance-none rounded-[5px] border border-base-700 bg-base-850 transition-colors checked:border-accent checked:bg-accent"
                    />
                    <span className="font-mono text-[12px] font-medium text-base-100">{device.name}</span>
                    {device.unnamed ? <Badge tone="warn">미할당</Badge> : null}
                    <span className="ml-auto font-mono text-[11px] text-base-500">
                      uid ...{uidSuffix(device.uid)}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <p className={`mt-2 text-[11px] leading-snug ${error ? "text-danger" : "text-base-500"}`}>
            {error ??
              "이미 세션이 진행 중인 기기는 FAIL 로 응답합니다. 그 경우 먼저 '게임 초기화' 후 다시 시작하세요."}
          </p>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-base-800 px-5 py-3.5">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            size="sm"
            variant="positive"
            onClick={() => void submit()}
            disabled={busy || sending || selected.size === 0}
          >
            <IconPlay className="size-3.5" />
            {busy ? "전송 중..." : `${selected.size}대에 팀 세션 시작`}
          </Button>
        </div>
      </div>
    </div>
  );
}
