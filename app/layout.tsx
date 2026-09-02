import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "OGP Services - Yard Maintenance Signup",
  description:
    "Sign up for OGP Services yard maintenance in Platinum Village, Rustenburg - cutting, weeding, edging, refuse removal and general tidy, year-round.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#146a3c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-brand-50 text-brand-900 antialiased">{children}</body>
    </html>
  );
}
