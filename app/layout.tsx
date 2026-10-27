import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { DemoBanner } from "@/components/demo-banner";
import { SiteHeader } from "@/components/site-header";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ReLoop: repair first, waste last",
  description:
    "An AI repair agent that diagnoses a broken device, books and pays a technician through PayPal, and releases payout only after the repair is verified.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:p-3">Skip to content</a>
        <DemoBanner />
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-border py-6 text-center text-sm text-muted">
          ReLoop · MIT licensed · built for the PayPal AI Hackathon
        </footer>
      </body>
    </html>
  );
}
