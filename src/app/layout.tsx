import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Boali Hospital — Radiology AI Workstation",
  description:
    "Boali Hospital Radiology AI Workstation — precision imaging, smarter diagnosis, healthier tomorrows. Interactive UI concept.",
  keywords: ["radiology", "workstation", "AI", "PACS", "Boali Hospital", "DICOM"],
  icons: {
    icon: "/mock/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0B121D] text-[#E8EEF5]`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
