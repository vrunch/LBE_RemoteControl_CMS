import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ws 는 Next 번들러가 건드리지 않고 Node 런타임에서 그대로 require 하도록 둔다.
  // (번들링될 경우 instrumentation 에서 소켓 서버가 중복 기동될 수 있음)
  serverExternalPackages: ["ws"],
};

export default nextConfig;
