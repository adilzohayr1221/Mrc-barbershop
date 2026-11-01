import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import PwaRegister from "@/components/PwaRegister";

// interactiveWidget: 'resizes-content' makes iOS Safari shrink the layout
// viewport when the keyboard opens (like Android), so fixed full-screen
// modals (chat) automatically stay above the keyboard with plain inset-0.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const SITE_URL = 'https://mrc-barbershop.vercel.app';
const OG_IMAGE = `${SITE_URL}/og-image.png`;
const DESCRIPTION =
  "Book your cut at MRC Barbershops — Baltimore, MD. One free haircut with the $120 plan.";

export const metadata: Metadata = {
  title: "MRC Barbershops",
  description: DESCRIPTION,
  themeColor: "#faf6ea",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "MRC Barbershops",
    description: DESCRIPTION,
    siteName: "MRC Barbershops",
    type: "website",
    url: SITE_URL,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "MRC Barbershops — Book cuts. Save with plans.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MRC Barbershops",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MRC Barbershops",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
