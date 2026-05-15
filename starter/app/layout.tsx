import type { Metadata } from "next";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset tracking — challenge starter",
  description: "Take-home: build the user experience on top of the asset tracking API.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <header className="border-b bg-white">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <a href="/" className="font-semibold text-gray-900">
              Asset tracking
            </a>
            <RoleSwitcher />
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
