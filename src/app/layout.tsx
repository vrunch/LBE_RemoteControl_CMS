import type { Metadata, Viewport } from "next";

import { LbeProvider } from "@/components/LbeProvider";
import { Sidebar } from "@/components/Sidebar";
import { ToastHost } from "@/components/ToastHost";
import { TopBar } from "@/components/TopBar";

import "./globals.css";

export const metadata: Metadata = {
  title: "LBE 원격 제어 콘솔",
  description: "웹소켓으로 LBE VR 기기를 원격 제어하는 관제 대시보드",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full antialiased">
        <LbeProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              <main className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5 sm:px-7 sm:py-6">
                {children}
              </main>
            </div>
          </div>
          <ToastHost />
        </LbeProvider>
      </body>
    </html>
  );
}
