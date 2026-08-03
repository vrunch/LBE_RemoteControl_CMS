import {
  TEAM_COUNT_MAX,
  TEAM_COUNT_MIN,
  TEAM_ID_MAX,
  TEAM_ID_MIN,
} from "@/lib/protocol";
import { getHub } from "@/server/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 대시보드에서 선택 기기들에 팀 세션 시작(teamId/인원수) 명령을 전송한다.
 * 기존 QR 스캔(PicoQRReader) 흐름을 원격으로 대체하는 API.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const { teamId, teamCount, targets } = (body ?? {}) as Record<string, unknown>;

  const id = Number(teamId);
  if (!Number.isInteger(id) || id < TEAM_ID_MIN || id > TEAM_ID_MAX) {
    return Response.json(
      { ok: false, error: `팀 ID는 ${TEAM_ID_MIN}~${TEAM_ID_MAX} 사이의 정수여야 합니다.` },
      { status: 400 },
    );
  }

  const count = Number(teamCount);
  if (!Number.isInteger(count) || count < TEAM_COUNT_MIN || count > TEAM_COUNT_MAX) {
    return Response.json(
      { ok: false, error: `인원수는 ${TEAM_COUNT_MIN}~${TEAM_COUNT_MAX} 사이의 정수여야 합니다.` },
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
    return Response.json({ ok: false, error: "선택된 기기가 없습니다." }, { status: 400 });
  }

  const result = getHub().startTeam(id, count, isAll ? "all" : (targets as string[]));
  return Response.json(result);
}
