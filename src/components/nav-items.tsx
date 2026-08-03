import { IconGauge, IconList, IconPlug } from "@/components/icons";

export const NAV_ITEMS = [
  { href: "/", label: "대시보드", desc: "기기 현황과 원격 제어", Icon: IconGauge },
  { href: "/logs", label: "실시간 로그", desc: "서버 이벤트 기록", Icon: IconList },
  { href: "/connection", label: "연결 정보", desc: "엔드포인트와 통신 규격", Icon: IconPlug },
] as const;

export function navTitle(pathname: string) {
  return NAV_ITEMS.find((item) => item.href === pathname) ?? NAV_ITEMS[0];
}
