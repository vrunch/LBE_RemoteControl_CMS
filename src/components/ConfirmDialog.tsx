"use client";

import { useEffect, useRef } from "react";

import { IconAlert } from "@/components/icons";
import { Button } from "@/components/ui";

type Props = {
  open: boolean;
  title: string;
  desc?: string;
  confirmLabel: string;
  tone?: "danger" | "warning" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

/** 되돌릴 수 없는 일괄 명령 앞에 한 번 잡아주는 확인 창 */
export function ConfirmDialog({
  open,
  title,
  desc,
  confirmLabel,
  tone = "danger",
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    confirmRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="animate-fade-in w-full max-w-sm rounded-xl border border-base-800 bg-base-880 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span
            className={`grid size-8 shrink-0 place-items-center rounded-lg border ${
              tone === "danger"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-warn/30 bg-warn/10 text-warn"
            }`}
          >
            <IconAlert className="size-4" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold text-base-100">{title}</h3>
            {desc ? <p className="mt-1.5 text-xs leading-relaxed text-base-400">{desc}</p> : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-base-800 px-5 py-3.5">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
          <Button ref={confirmRef} size="sm" variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
