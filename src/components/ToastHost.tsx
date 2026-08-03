"use client";

import { IconAlert, IconCheck } from "@/components/icons";
import { useLbe } from "@/components/LbeProvider";

const TONE = {
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
} as const;

export function ToastHost() {
  const { toasts, dismissToast } = useLbe();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismissToast(toast.id)}
          className="animate-fade-in pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-base-800 bg-base-880 px-3.5 py-3 text-left shadow-lg shadow-black/40 transition-colors hover:bg-base-850"
        >
          <span
            className={`mt-px grid size-5 shrink-0 place-items-center rounded-md border ${TONE[toast.tone]}`}
          >
            {toast.tone === "ok" ? (
              <IconCheck className="size-3" />
            ) : (
              <IconAlert className="size-3" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-base-100">{toast.title}</span>
            {toast.desc ? (
              <span className="mt-0.5 block text-[11px] leading-snug break-words text-base-400">
                {toast.desc}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
