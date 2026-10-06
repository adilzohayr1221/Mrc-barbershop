"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarIcon, UserIcon, StarIcon } from "@/components/Icons";
import { CUSTOMER_TOKEN_KEY } from "@/components/CustomerAuth";

function homeFor(path: string): string {
  if (path.startsWith("/customer")) return "/customer";
  if (path.startsWith("/barber")) return "/barber";
  if (path.startsWith("/owner")) return "/owner";
  return "/";
}

export default function SiteHeader() {
  const pathname = usePathname();
  const home = homeFor(pathname || "/");
  const isCustomerArea = (pathname || "").startsWith("/customer") && pathname !== "/customer/login";
  const [customerLoggedIn, setCustomerLoggedIn] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!isCustomerArea) {
      setCustomerLoggedIn(false);
      setProfilePhoto(null);
      return;
    }
    const token = localStorage.getItem(CUSTOMER_TOKEN_KEY);
    setCustomerLoggedIn(!!token);
    if (token) {
      fetch('/api/customer/profile', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => { if (d.profile?.photoUrl) setProfilePhoto(d.profile.photoUrl); })
        .catch(() => {});
    } else {
      setProfilePhoto(null);
    }
  }, [pathname, isCustomerArea]);

  return (
    <header className="sticky top-0 z-50 bg-[#faf6ea]/85 backdrop-blur-md border-b border-[#e6dabf]">
      <div className="max-w-md mx-auto px-4 py-2.5 flex items-center gap-3">
        <Link href={home} className="flex items-center gap-2.5" aria-label="MRC Barbershop home">
          <Image
            src="/logo.jpg"
            alt="MRC Barbershop logo"
            width={38}
            height={38}
            className="rounded-full border-2 border-[#a8821f]/70 shadow-[0_0_14px_rgba(212,175,55,0.35)]"
            priority
          />
          <span className="font-extrabold tracking-tight text-[17px] leading-none">
            <span className="gold-text">MRC Barbershop</span>
          </span>
        </Link>
        {isCustomerArea && customerLoggedIn && (
          <nav className="ml-auto flex items-center gap-1.5 shrink-0">
            <Link
              href="/customer/appointments"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-gold transition-colors px-2.5 py-2 rounded-xl min-h-[40px]"
            >
              <CalendarIcon size={16} className="text-gold" />
              <span className="hidden sm:inline">My appointments</span>
              <span className="sm:hidden">Bookings</span>
            </Link>
            <Link
              href="/customer/offers"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-gold transition-colors px-2.5 py-2 rounded-xl min-h-[40px]"
            >
              <StarIcon size={16} className="text-gold" />
              Offers
            </Link>
            <Link
              href="/customer/profile"
              aria-label="Profile"
              title="Profile"
              className="inline-flex items-center justify-center text-neutral-500 hover:text-gold transition-colors p-1 rounded-full min-h-[40px] min-w-[40px]"
            >
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt="Profile"
                  className="w-8 h-8 rounded-full object-cover border-2 border-gold/60"
                />
              ) : (
                <span className="w-8 h-8 rounded-full bg-gold/10 border border-gold/40 flex items-center justify-center text-gold">
                  <UserIcon size={16} />
                </span>
              )}
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
