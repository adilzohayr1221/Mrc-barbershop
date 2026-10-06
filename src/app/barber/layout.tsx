import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-barber.webmanifest",
};

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
