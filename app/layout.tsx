import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import { Toaster } from "sonner";
import "./globals.css";
import { DemoBanner } from "@/components/demo-banner";
import { SiteHeader } from "@/components/site-header";
import { DemoGuide } from "@/components/demo-guide";
import { FlashToast } from "@/components/flash-toast";
import { TourHost } from "@/components/tour/tour-host";
import { isDemoMode } from "@/lib/ai/config";
import { paypalMode } from "@/lib/paypal/client";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ReLoop: repair first, waste last", template: "%s | ReLoop" },
  description:
    "An AI repair agent that diagnoses a broken device, books and pays a technician through PayPal, and releases payout only after the repair is verified.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const showGuide = isDemoMode() || paypalMode() === "simulated" || process.env.DEMO_ACTIONS === "true";
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:p-3">Skip to content</a>
        <Toaster richColors position="top-center" />
        {process.env.DEMO_ACTIONS === "true" && <TourHost />}
        <Suspense fallback={null}><FlashToast /></Suspense>
        <DemoBanner />
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        {showGuide && <DemoGuide buyerEmail={process.env.NEXT_PUBLIC_DEMO_BUYER_EMAIL} buyerNote={process.env.NEXT_PUBLIC_DEMO_BUYER_NOTE} ownerEmail={process.env.NEXT_PUBLIC_DEMO_OWNER_EMAIL} techEmail={process.env.NEXT_PUBLIC_DEMO_TECH_EMAIL} passwordNote={process.env.NEXT_PUBLIC_DEMO_PASSWORD_NOTE} tourEnabled={process.env.DEMO_ACTIONS === "true"} />}
        <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted">
          ReLoop · sandbox demo, no real money moves · MIT licensed · built for the PayPal AI Hackathon
        </footer>
      </body>
    </html>
  );
}
