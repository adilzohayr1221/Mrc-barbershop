import Link from "next/link";
import Image from "next/image";
import { ScissorsIcon, PoleIcon, KeyIcon, ArrowRightIcon } from "@/components/Icons";

const roles = [
  {
    href: "/customer",
    title: "I'm a Customer",
    desc: "Find a branch, pick your barber, book your cut.",
    Icon: ScissorsIcon,
  },
  {
    href: "/barber",
    title: "I'm a Barber",
    desc: "See today's schedule and your reviews.",
    Icon: PoleIcon,
  },
  {
    href: "/owner",
    title: "Shop Owner",
    desc: "Manage barbers, services, prices and bookings.",
    Icon: KeyIcon,
  },
];

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      <div className="relative">
        <Image
          src="/logo.jpg"
          alt="MRC Barbershop logo"
          width={132}
          height={132}
          className="hero-logo"
          priority
        />
      </div>

      <p className="mt-8 text-[11px] font-semibold tracking-[0.35em] uppercase text-gold/80">
        Baltimore · Maryland
      </p>
      <h1 className="mt-2 text-5xl font-extrabold tracking-tight text-center leading-tight">
        <span className="gold-text">MRC Barbershop</span>
      </h1>

      <div className="ornament w-56 mt-5">
        <span className="ornament-diamond" />
      </div>

      <p className="mt-4 text-neutral-600 text-center max-w-sm text-[15px] leading-relaxed">
        Premium cuts, classic craft. Choose how you&apos;re visiting today.
      </p>

      <div className="mt-10 grid gap-3.5 w-full max-w-md">
        {roles.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="card card-hover p-5 flex items-center gap-4"
          >
            <span className="flex items-center justify-center w-12 h-12 rounded-full shrink-0 bg-gold/10 border border-gold/40 text-gold">
              <r.Icon size={24} />
            </span>
            <span className="flex-1">
              <span className="block font-bold text-[17px]">{r.title}</span>
              <span className="block text-sm text-neutral-600 mt-0.5">{r.desc}</span>
            </span>
            <span className="text-gold/70">
              <ArrowRightIcon size={22} />
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-10 w-full max-w-md">
        <div className="map-frame relative h-44 overflow-hidden">
          <Image
            src="/interior.jpg"
            alt="Inside MRC Barbershop"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#17130a]/75 via-[#17130a]/10 to-transparent" />
          <div className="absolute bottom-3.5 left-4 right-4 flex items-end justify-between gap-3">
            <p className="text-white text-[15px] font-bold drop-shadow leading-snug">
              Walk-ins welcome.
              <span className="block text-[12px] font-medium text-white/85">Classic cuts, done right.</span>
            </p>
            <span className="shrink-0 text-[11px] font-semibold tracking-[0.18em] uppercase text-[#f0d97a] border border-[#f0d97a]/50 bg-black/30 backdrop-blur rounded-full px-3 py-1.5">
              Baltimore, MD
            </span>
          </div>
        </div>
      </div>

      <p className="mt-12 text-xs text-neutral-600 tracking-wide">
        127 S Broadway · 2904 O&apos;Donnell St · Baltimore, MD
      </p>
      <p className="mt-3 text-xs">
        <Link href="/partners" className="text-gold/80 underline underline-offset-4 font-semibold">
          Own a barbershop? Get your own app →
        </Link>
      </p>
    </main>
  );
}
