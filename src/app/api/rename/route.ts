import { getHub } from "@/server/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 기기 표시이름 변경.
 * target 은 현재 표시이름 또는 uid 를 받는다.
 * 매핑 테이블을 갱신하고, 접속 중이면 기기에 SET_NAME 을 내려보낸다.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const { target, name } = (body ?? {}) as Record<string, unknown>;

  if (typeof target !== "string" || !target.trim()) {
    return Response.json({ ok: false, error: "대상 기기를 지정하세요." }, { status: 400 });
  }
  if (typeof name !== "string") {
    return Response.json({ ok: false, error: "새 이름을 입력하세요." }, { status: 400 });
  }

  const result = getHub().rename(target, name);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
