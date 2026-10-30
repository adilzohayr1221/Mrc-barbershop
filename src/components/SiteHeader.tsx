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
  // When the customer is inside one shop (branch page or its booking page),
  // the header carries that shop's own name instead of the platform brand.
  const [shopName, setShopName] = useState<string | null>(null);

  useEffect(() => {
    const p = pathname || "";
    let branchId: string | null = null;
    const m = p.match(/^\/customer\/branch\/([^/]+)/);
    if (m) {
      branchId = decodeURIComponent(m[1]);
    } else if (/^\/customer\/book\/[^/]+/.test(p)) {
      try {
        branchId = new URLSearchParams(window.location.search).get("branchId");
      } catch {
        branchId = null;
      }
    }
    if (!branchId) {
      setShopName(null);
      return;
    }
    let live = true;
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const b = (d.branches || []).find((x: { id: string }) => x.id === branchId);
        if (live) setShopName(b?.name ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

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

  // Brand stacked on two lines so the full name always shows (his request):
  // "MRC" on top, "Barbershops" underneath. For a shop name with a branch
  // suffix ("MRC Barbershops — S Broadway") the head goes on line 1 at a
  // smaller size and the branch part on line 2.
  const fullName = shopName ?? 'MRC Barbershops';
  const dashAt = fullName.indexOf(' — ');
  let brandLine1: string;
  let brandLine2: string;
  let brandLine1Size: string;
  if (dashAt > 0) {
    brandLine1 = fullName.slice(0, dashAt);
    brandLine2 = fullName.slice(dashAt + 3);
    brandLine1Size = 'text-[13.5px]';
  } else {
    const spAt = fullName.indexOf(' ');
    brandLine1 = spAt > 0 ? fullName.slice(0, spAt) : fullName;
    brandLine2 = spAt > 0 ? fullName.slice(spAt + 1) : '';
    brandLine1Size = 'text-[17px]';
  }

  // Presentation only: which nav item matches the current page (for the
  // gold-glow active pill). Routing and link order are unchanged.
  const navActive = (href: string) => (pathname || "").startsWith(href);

  return (
    <header className="sticky top-0 z-50 glass-header">
      <div className="max-w-md mx-auto px-4 py-2.5 flex items-center gap-3">
        <Link href={home} className="flex items-center gap-2.5 min-w-0" aria-label={shopName ? `${shopName} home` : "MRC Barbershops home"}>
          <Image
            src="/logo-halloween.png"
            alt={shopName ? `${shopName} logo` : "MRC Barbershops logo"}
            width={38}
            height={38}
            className="rounded-full border-2 border-[#a8821f]/70 shadow-[0_0_14px_rgba(212,175,55,0.35)] shrink-0"
            priority
          />
          <span className="min-w-0 leading-none">
            <span className={`gold-text block font-extrabold tracking-tight ${brandLine1Size}`}>{brandLine1}</span>
            {brandLine2 && <span className="gold-text block font-bold text-[12.5px] truncate mt-[3px]">{brandLine2}</span>}
          </span>
        </Link>
        {isCustomerArea && customerLoggedIn && (
          <nav className="ml-auto flex items-center gap-1.5 shrink-0">
            <Link
              href="/customer/appointments"
              aria-current={navActive("/customer/appointments") ? "page" : undefined}
              className={`glass-nav-item inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-gold px-2.5 py-2 rounded-xl min-h-[40px] ${navActive("/customer/appointments") ? "glass-nav-active" : ""}`}
            >
              <CalendarIcon size={16} className="text-gold" />
              <span className="hidden sm:inline">My appointments</span>
              <span className="sm:hidden">Bookings</span>
            </Link>
            <Link
              href="/customer/offers"
              aria-current={navActive("/customer/offers") ? "page" : undefined}
              className={`glass-nav-item inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-gold px-2.5 py-2 rounded-xl min-h-[40px] ${navActive("/customer/offers") ? "glass-nav-active" : ""}`}
            >
              <StarIcon size={16} className="text-gold" />
              Offers
            </Link>
            <Link
              href="/customer/profile"
              aria-label="Profile"
              aria-current={navActive("/customer/profile") ? "page" : undefined}
              title="Profile"
              className={`glass-nav-item inline-flex items-center justify-center text-neutral-500 hover:text-gold p-1 rounded-full min-h-[40px] min-w-[40px] ${navActive("/customer/profile") ? "glass-nav-active" : ""}`}
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
