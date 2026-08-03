import { getHub } from "@/server/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 매핑 테이블에서 기기 항목을 제거한다.
 * 접속 중인 기기는 제거할 수 없고, 제거해도 다시 접속하면 미할당 이름으로 재등록된다.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const { target } = (body ?? {}) as Record<string, unknown>;

  if (typeof target !== "string" || !target.trim()) {
    return Response.json({ ok: false, error: "대상 기기를 지정하세요." }, { status: 400 });
  }

  const result = getHub().forget(target);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
