import type { Metadata } from "next";
import AiAssistant from "@/components/AiAssistant";
import { LanguageProvider } from "@/components/LanguageContext";

export const metadata: Metadata = {
  manifest: "/manifest-customer.webmanifest",
};

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      {children}
      <AiAssistant />
    </LanguageProvider>
  );
}
