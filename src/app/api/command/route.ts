import { COMMANDS, isCommandKey, type CommandResult } from "@/lib/protocol";
import { getHub } from "@/server/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 대시보드에서 기기로 명령을 전송한다. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const { command, targets } = (body ?? {}) as Record<string, unknown>;

  if (!isCommandKey(command)) {
    return Response.json(
      { ok: false, error: `알 수 없는 명령입니다: ${String(command)}` },
      { status: 400 },
    );
  }

  const isAll = targets === "all";
  const isList = Array.isArray(targets) && targets.every((t) => typeof t === "string");

  if (!isAll && !isList) {
    return Response.json(
      { ok: false, error: "대상은 기기 ID 배열 또는 \"all\" 이어야 합니다." },
      { status: 400 },
    );
  }

  if (isList && targets.length === 0) {
    return Response.json(
      {
        ok: false,
        command,
        label: COMMANDS[command].label,
        sent: [],
        failed: [],
        error: "선택된 기기가 없습니다.",
      } satisfies CommandResult,
      { status: 400 },
    );
  }

  const result = getHub().sendCommand(command, isAll ? "all" : (targets as string[]));
  return Response.json(result);
}
