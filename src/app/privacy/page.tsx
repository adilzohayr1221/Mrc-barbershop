import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — MRC Barbershop',
  description: 'How MRC Barbershop collects, uses, and protects your data.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#faf6ea] text-[#1c1a15] px-6 py-10 max-w-2xl mx-auto">
      <h1 className="text-3xl font-extrabold mb-2">Privacy Policy</h1>
      <p className="text-sm text-neutral-500 mb-8">Last updated: October 6, 2026</p>

      <section className="space-y-6 text-[15px] leading-relaxed">
        <div>
          <h2 className="text-lg font-bold mb-2">1. What we collect</h2>
          <p>
            <strong>Account info:</strong> your name, email address, and profile photo (if you upload one).
            <br />
            <strong>Bookings:</strong> the services, barbers, dates, and times you book.
            <br />
            <strong>Payments:</strong> processed securely by Stripe. We never see or store your full card number.
            <br />
            <strong>Photos:</strong> complaint photos you take with your camera, and work photos barbers upload.
            <br />
            <strong>Location:</strong> used only to sort branches by distance, with your permission. Never stored.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">2. How we use it</h2>
          <p>
            To run the booking service: create appointments, process deposits and plans, send reminders,
            handle complaints, and show barbers the info they need for your visit (name, photo, booking).
            We do not sell your data. We do not show you ads.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">3. Push notifications</h2>
          <p>
            With your permission we send booking reminders, plan week alerts, and service updates.
            You can turn these off anytime in the app or your device settings.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">4. Data sharing</h2>
          <p>
            <strong>Stripe:</strong> payments are processed by Stripe under their privacy policy.
            <br />
            <strong>Barbers &amp; shop owners:</strong> see your name, booking details, and profile photo so they can serve you.
            <br />
            We share nothing else with third parties.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">5. Your rights</h2>
          <p>
            You can update your name and photo in the app at any time. To delete your account and
            personal data, contact us at the shop or through the app&apos;s help section and we will
            remove it.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">6. Children</h2>
          <p>
            The app is not directed at children under 13. Family plan memberships are managed by the
            adult account holder.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-2">7. Contact</h2>
          <p>
            MRC Barbershop LLC, Baltimore, MD.
            <br />
            Questions about this policy: ask through the app&apos;s help section.
          </p>
        </div>
      </section>
    </main>
  );
}
