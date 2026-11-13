import type { Metadata } from "next";
import { Barlow_Condensed } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SCADA Progression",
  description: "Estado dos RTU e planeamento da telegestão — ProÁgua Pilar 2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT" className={display.variable}>
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}