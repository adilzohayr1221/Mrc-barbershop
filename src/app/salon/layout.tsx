import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-salon.webmanifest",
};

export default function SalonLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
