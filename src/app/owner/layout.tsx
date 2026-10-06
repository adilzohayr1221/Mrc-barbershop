import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-owner.webmanifest",
};

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
