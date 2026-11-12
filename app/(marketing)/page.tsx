import type { Metadata } from "next";

import { Faq } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero/hero";

export const metadata: Metadata = {
  title: { absolute: "OpenDashboards | The open-source alternative to Claude Dashboards" },
  description: "Ask any question across PostHog, your database, and any MCP server. Get a live dashboard.",
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
