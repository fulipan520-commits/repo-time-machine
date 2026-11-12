import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repo Time Machine",
  description:
    "See how a codebase became what it is today through an evidence-backed architecture timeline.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
