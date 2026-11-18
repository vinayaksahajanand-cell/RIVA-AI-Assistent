import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_FULL_NAME, APP_NAME, APP_TAGLINE } from "@/lib/config";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — ${APP_TAGLINE}`, template: `%s · ${APP_NAME}` },
  description: `${APP_NAME} (${APP_FULL_NAME}) — ${APP_TAGLINE}.`,
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full`}>
      <body className="h-full min-h-dvh bg-background">
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster position="top-right" closeButton />
        </TooltipProvider>
      </body>
    </html>
  );
}
