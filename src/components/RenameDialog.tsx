"use client";

import { useEffect, useState } from "react";

import { IconTag } from "@/components/icons";
import { useLbe } from "@/components/LbeProvider";
import { Badge, Button } from "@/components/ui";
import { NAME_MAX_LENGTH, uidSuffix, validateName, type DeviceView } from "@/lib/protocol";

/**
 * 표시이름 변경 창.
 * 실제 이름의 원본은 서버 매핑 테이블이므로, 여기서는 요청만 보내고 결과를 기다린다.
 */
export function RenameDialog({ device, onClose }: { device: DeviceView | null; onClose: () => void }) {
  if (!device) return null;
  // key 를 걸어 다른 기기를 열 때마다 입력 상태가 새로 시작되게 한다.
  return <RenameForm key={device.uid} device={device} onClose={onClose} />;
}

function RenameForm({ device, onClose }: { device: DeviceView; onClose: () => void }) {
  const { renameDevice } = useLbe();

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = async () => {
    const check = validateName(value);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setBusy(true);
    setError(null);

    // uid 로 보내야 이름이 동시에 바뀌어도 엉뚱한 기기를 건드리지 않는다.
    const result = await renameDevice(device.uid, check.name);
    setBusy(false);

    if (result.ok) onClose();
    else setError(result.error ?? "이름을 변경하지 못했습니다.");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="기기 이름 변경"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-sm rounded-xl border border-base-800 bg-base-880 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <IconTag className="size-4" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold text-base-100">기기 이름 변경</h3>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-base-400">
              <span className="font-mono">{device.name}</span>
              <span className="text-base-500">·</span>
              <span className="font-mono text-base-500">uid ...{uidSuffix(device.uid)}</span>
              {device.status === "offline" ? <Badge tone="muted">오프라인</Badge> : null}
            </p>
          </div>
        </div>

        <div className="px-5 pt-4">
          <input
            value={value}
            autoFocus
            maxLength={NAME_MAX_LENGTH}
            placeholder="예: HMD_01"
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) void submit();
            }}
            className={`focus-ring h-9 w-full rounded-lg border bg-base-850 px-3 font-mono text-[13px] text-base-100 placeholder:font-sans placeholder:text-base-500 ${
              error ? "border-danger/50" : "border-base-800"
            }`}
          />
          <p className={`mt-1.5 text-[11px] leading-snug ${error ? "text-danger" : "text-base-500"}`}>
            {error ?? `영문, 숫자, _, - 만 사용할 수 있습니다. (최대 ${NAME_MAX_LENGTH}자)`}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-base-500">
            {device.status === "online"
              ? "변경하면 기기에도 즉시 전달되어 로컬 캐시가 갱신됩니다."
              : "지금은 오프라인이라 서버 테이블만 바뀌고, 다음 접속 때 기기에 반영됩니다."}
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-base-800 px-5 py-3.5">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "변경 중..." : "변경"}
          </Button>
        </div>
      </div>
    </div>
  );
}
