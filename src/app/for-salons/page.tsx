import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarIcon,
  ReceiptIcon,
  StarIcon,
  QrIcon,
  GlobeIcon,
  GearIcon,
  CheckSealIcon,
  PhoneIcon,
  ArrowRightIcon,
} from "@/components/Icons";

export const metadata: Metadata = {
  title: "MRC for Salons — Turn Your Barbershop Into a Booking Machine",
  description:
    "Online booking, instant barber payouts, memberships and Apple Wallet cards. The complete system for barbershop and salon owners.",
};

// TODO: replace with the real WhatsApp number before sharing this page.
const WHATSAPP_NUMBER_DISPLAY = "+1 (443) 741-5820";
const WHATSAPP_LINK =
  "https://wa.me/14437415820?text=" +
  encodeURIComponent("Hi MRC! I own a barbershop/salon and I want to know more about your booking system.");

function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.1 3.2 5.1 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.76-.72 2-1.42.25-.7.25-1.29.18-1.42-.08-.13-.28-.2-.58-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88a9.82 9.82 0 0 1 9.88 9.89c0 5.45-4.44 9.88-9.89 9.88m8.42-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.9 11.9 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.16-3.47-8.41" />
    </svg>
  );
}

const pains = [
  {
    emoji: "💸",
    title: "No online payments",
    desc: "Cash-only chaos. Chasing money at the chair, no records, no proof of who paid what. Every week ends with a math headache.",
  },
  {
    emoji: "📞",
    title: "No appointment system",
    desc: "Missed calls mean lost customers — they just book somewhere else. Pen-and-paper double-books, and your barbers stand around waiting.",
  },
  {
    emoji: "🚫",
    title: "No-shows, payout fights, no loyalty",
    desc: "Empty chairs eat your profit. Paying barbers fairly is a weekly argument. And once a customer leaves, nothing brings them back.",
  },
];

const features = [
  {
    Icon: CalendarIcon,
    title: "Online booking with $5 deposits",
    desc: "Customers book their barber, day and time in seconds. A card deposit locks it in — no-shows cost them, not you.",
  },
  {
    Icon: ReceiptIcon,
    title: "Online payments + instant barber payouts",
    desc: "Stripe handles every payment. Barbers get paid instantly after each cut — no cash envelopes, no weekly arguments.",
  },
  {
    Icon: StarIcon,
    title: "$120/mo memberships",
    desc: "Recurring revenue on autopilot. Members get a weekly cut, you get predictable income every single month.",
  },
  {
    Icon: QrIcon,
    title: "Apple Wallet cards",
    desc: "Every customer carries your shop in their pocket. Walk near your shop and their phone reminds them to come in.",
  },
  {
    Icon: GlobeIcon,
    title: "4 languages built in",
    desc: "English, Arabic, French and Spanish. Every customer and barber uses the app in their own language.",
  },
  {
    Icon: CheckSealIcon,
    title: "Reviews, tips & gift cards",
    desc: "Five-star reviews build your name automatically. Tips go straight to barbers. Gift cards sell your cuts as presents.",
  },
  {
    Icon: GearIcon,
    title: "Owner dashboard",
    desc: "Bookings, barbers, services, prices, reviews and earnings — your entire shop on one phone screen, from anywhere.",
  },
];

const steps = [
  {
    n: "1",
    title: "We set up your shop",
    desc: "Your branches, services, prices and barbers — configured for you in days, not months.",
  },
  {
    n: "2",
    title: "Your barbers join",
    desc: "Each barber gets their own app: schedule, payouts, tips and their customer reviews.",
  },
  {
    n: "3",
    title: "Customers book",
    desc: "They book online, pay deposits, get Wallet cards — and keep coming back.",
  },
];

export default function ForSalons() {
  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-5 pb-16">
      {/* ---------- HERO ---------- */}
      <section className="pt-10 pb-8 text-center">
        <div className="flex justify-center">
          <Image
            src="/logo.jpg"
            alt="MRC Barbershops logo"
            width={96}
            height={96}
            className="rounded-full border-2 border-gold/50 shadow-[0_0_24px_rgba(212,175,55,0.35)]"
            priority
          />
        </div>
        <p className="mt-6 text-[11px] font-bold tracking-[0.3em] uppercase text-gold">
          For barbershop &amp; salon owners
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight leading-tight">
          Turn your barbershop into a <span className="gold-text">booking machine</span>
        </h1>
        <p className="mt-4 text-neutral-600 text-[16px] leading-relaxed max-w-xl mx-auto">
          More bookings. Instant barber payouts. Zero missed appointments.
          The complete system that runs your shop while you cut hair.
        </p>
        <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="gold-btn rounded-2xl px-7 py-4 text-[16px] inline-flex items-center justify-center gap-2.5"
          >
            <WhatsAppIcon size={20} />
            Chat on WhatsApp
          </a>
          <a href="#how" className="gold-outline-btn rounded-2xl px-7 py-4 text-[16px] inline-flex items-center justify-center gap-2">
            See how it works
            <ArrowRightIcon size={16} />
          </a>
        </div>
      </section>

      {/* ---------- PROBLEM ---------- */}
      <section className="py-10">
        <h2 className="text-center text-2xl font-extrabold tracking-tight">
          Sound <span className="gold-text">familiar?</span>
        </h2>
        <p className="text-center text-neutral-600 mt-2 text-[15px] max-w-lg mx-auto">
          These three problems cost almost every salon owner money every single week.
        </p>
        <div className="mt-6 grid gap-4">
          {pains.map((p) => (
            <div key={p.title} className="card p-5 border-l-4 !border-l-red-700">
              <p className="text-[26px]">{p.emoji}</p>
              <h3 className="mt-2 text-[17px] font-bold">{p.title}</h3>
              <p className="mt-1.5 text-[14px] text-neutral-600 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-center mt-6 text-[16px] font-semibold text-neutral-700">
          Every one of these is money walking out your door.{" "}
          <span className="gold-text">MRC fixes all three.</span>
        </p>
      </section>

      <div className="ornament w-48 mx-auto">
        <span className="ornament-diamond" />
      </div>

      {/* ---------- FEATURES ---------- */}
      <section className="py-10">
        <h2 className="text-center text-2xl font-extrabold tracking-tight">
          One system. <span className="gold-text">Every problem solved.</span>
        </h2>
        <p className="text-center text-neutral-600 mt-2 text-[15px] max-w-lg mx-auto">
          Each feature below is the direct fix for the problems above.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="card card-hover p-5">
              <span className="inline-flex w-11 h-11 rounded-full bg-gold/10 border border-gold/40 items-center justify-center text-gold">
                <f.Icon size={22} />
              </span>
              <h3 className="mt-3 text-[16px] font-bold">{f.title}</h3>
              <p className="mt-1.5 text-[14px] text-neutral-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="py-10">
        <h2 className="text-center text-2xl font-extrabold tracking-tight">
          Live in <span className="gold-text">3 steps</span>
        </h2>
        <div className="mt-6 grid gap-4">
          {steps.map((s) => (
            <div key={s.n} className="card p-5 flex gap-4 items-start">
              <span className="shrink-0 w-10 h-10 rounded-full bg-gold text-white font-extrabold text-[18px] flex items-center justify-center">
                {s.n}
              </span>
              <div>
                <h3 className="text-[16px] font-bold">{s.title}</h3>
                <p className="mt-1 text-[14px] text-neutral-600 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- PRICING TEASER ---------- */}
      <section className="py-10">
        <div className="card p-7 text-center border-2 !border-gold/50 bg-gradient-to-b from-gold/10 to-transparent">
          <h2 className="text-2xl font-extrabold tracking-tight">
            One simple plan. <span className="gold-text">Serious results.</span>
          </h2>
          <p className="mt-3 text-neutral-600 text-[15px] leading-relaxed max-w-md mx-auto">
            Pricing depends on your shop size and needs. Message us and we&apos;ll
            put together the right plan for you — no pressure, no obligation.
          </p>
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="gold-btn rounded-2xl px-8 py-4 text-[16px] inline-flex items-center justify-center gap-2.5 mt-6"
          >
            <WhatsAppIcon size={20} />
            Contact us for pricing
          </a>
        </div>
      </section>

      {/* ---------- CONTACT ---------- */}
      <section className="py-6 text-center">
        <h2 className="text-2xl font-extrabold tracking-tight">
          Ready when <span className="gold-text">you are</span>
        </h2>
        <p className="mt-2 text-neutral-600 text-[15px]">
          Talk to a real person. We&apos;ll answer every question.
        </p>
        <a
          href={WHATSAPP_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 w-full rounded-2xl px-8 py-5 text-[18px] font-bold text-white inline-flex items-center justify-center gap-3 shadow-lg"
          style={{ backgroundColor: "#25D366" }}
        >
          <WhatsAppIcon size={24} />
          WhatsApp us now
        </a>
        <a
          href={`tel:${WHATSAPP_NUMBER_DISPLAY.replace(/[^+\d]/g, "")}`}
          className="mt-4 inline-flex items-center gap-2 text-gold font-bold text-[17px]"
        >
          <PhoneIcon size={18} />
          {WHATSAPP_NUMBER_DISPLAY}
        </a>
        <p className="mt-8 text-[12px] text-neutral-400">
          <Link href="/" className="underline">
            MRC Barbershops
          </Link>{" "}
          · Baltimore, MD
        </p>
      </section>
    </main>
  );
}
