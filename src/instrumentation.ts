// Next.js 서버 프로세스가 뜰 때 한 번 실행된다.
// 여기서 LBE 웹소켓 허브를 기동해 두면 첫 요청 전부터 HMD 접속을 받을 수 있다.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getHub } = await import("@/server/hub");
  getHub();
}
