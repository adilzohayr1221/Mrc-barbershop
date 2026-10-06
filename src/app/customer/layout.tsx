import type { Metadata } from "next";
import AiAssistant from "@/components/AiAssistant";

export const metadata: Metadata = {
  manifest: "/manifest-customer.webmanifest",
};

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AiAssistant />
    </>
  );
}
