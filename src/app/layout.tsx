import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DUALDEV — Build and fix",
  description: "One AI. Two superpowers. Build and fix.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
