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

const SITE_URL = 'https://mrc-barbershop-mrc-0043.vercel.app';
const OG_IMAGE = `${SITE_URL}/logo.jpg`;

export const metadata: Metadata = {
  title: "MRC Barbershop",
  description: "Book your cut at MRC Barbershop — Baltimore, MD",
  themeColor: "#faf6ea",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "MRC Barbershop",
    description: "Book your cut at MRC Barbershop — Baltimore, MD",
    siteName: "MRC Barbershop",
    type: "website",
    url: SITE_URL,
    images: [
      {
        url: OG_IMAGE,
        width: 1284,
        height: 1284,
        alt: "MRC Barbershop",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MRC Barbershop",
    description: "Book your cut at MRC Barbershop — Baltimore, MD",
    images: [OG_IMAGE],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MRC Barbershop",
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
