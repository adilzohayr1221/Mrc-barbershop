import type { Metadata } from "next";
import { LanguageProvider } from "@/components/LanguageContext";

export const metadata: Metadata = {
  manifest: "/manifest-barber.webmanifest",
};

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}
