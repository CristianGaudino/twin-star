import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twin Star — Prototype",
  description: "Twin Star extraction game prototype",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full w-full overflow-hidden bg-black antialiased">{children}</body>
    </html>
  );
}
