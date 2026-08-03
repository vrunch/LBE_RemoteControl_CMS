import { getHub } from "@/server/hub";
import type { StreamMessage } from "@/lib/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_INTERVAL = 15_000;

/**
 * 기기 목록 / 로그를 브라우저로 밀어주는 SSE 스트림.
 * EventSource 가 끊기면 브라우저가 알아서 재연결한다.
 */
export async function GET(request: Request) {
  const hub = getHub();
  const encoder = new TextEncoder();

  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 이미 닫힌 스트림에 쓰려 한 경우 - 정리만 하고 조용히 종료
          cleanup();
        }
      };

      const send = (message: StreamMessage) => write(`data: ${JSON.stringify(message)}\n\n`);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
        if (keepalive) clearInterval(keepalive);
        keepalive = null;
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      // 접속 직후 현재 상태 전체를 한 번 내려준다.
      send({ type: "init", snapshot: hub.getSnapshot(), logs: hub.getLogs() });

      unsubscribe = hub.subscribe(send);

      // 프록시가 유휴 커넥션을 끊지 않도록 주기적으로 주석 프레임 전송
      keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_INTERVAL);

      if (request.signal.aborted) cleanup();
      else request.signal.addEventListener("abort", cleanup);
    },

    cancel() {
      closed = true;
      unsubscribe?.();
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx 등 리버스 프록시의 버퍼링 방지
      "X-Accel-Buffering": "no",
    },
  });
}
