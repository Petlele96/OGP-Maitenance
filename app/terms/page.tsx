import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { COMPANY_NAME, COMPANY_REG, COMPANY_CSD, WHATSAPP_DISPLAY, WHATSAPP_LINK } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms and Conditions | OGP Services",
};

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-navy/10 py-10">
      <h2 className="text-lg font-bold text-navy">
        <span className="text-navy/40">{number}.</span> {title}
      </h2>
      <div className="mt-4 flex flex-col gap-3 text-[15px] leading-relaxed text-navy/80">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="pl-4 relative before:absolute before:left-0 before:content-['–']">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-lg bg-white px-6 pb-20 text-navy">
      <header className="pb-10 pt-14">
        <Image src="/logo.png" alt="OGP Services" width={320} height={320} className="h-9 w-auto" />
        <h1 className="mt-8 text-3xl font-extrabold leading-tight tracking-tight text-navy">
          Terms and Conditions
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-navy/60">
          {COMPANY_NAME}
          <br />
          Registration: {COMPANY_REG} &middot; CSD: {COMPANY_CSD}
          <br />
          Platinum Village, Rustenburg, North West
        </p>
        <p className="mt-4 text-xs text-navy/40">Last updated: September 2026</p>
      </header>

      <Section number="1" title="What this service is">
        <p>We look after the outside of your yard on a regular basis.</p>
        <p className="font-medium text-navy">Included:</p>
        <List
          items={[
            "Cutting grass",
            "Weeding",
            "Edging along walls, paving and fences",
            "Removing garden cuttings and bagging them",
            "General tidy-up of the yard area",
          ]}
        />
        <p className="font-medium text-navy">Not included:</p>
        <List
          items={[
            "Anything inside your house",
            "Household rubbish or municipal refuse (that stays with the municipality on Thursdays)",
            "Tree felling or cutting large branches",
            "Planting, landscaping or garden design",
            "Fixing paving, walls, taps or irrigation",
            "Cleaning windows, gutters or roofs",
            "Washing cars",
          ]}
        />
        <p>
          If you want something that is not on the included list, ask us. We may do it for an extra fee, agreed in
          writing first.
        </p>
      </Section>

      <Section number="2" title="How often we come">
        <p>
          <span className="font-medium text-navy">September to April:</span> twice a month
          <br />
          <span className="font-medium text-navy">May to August:</span> once a month
        </p>
        <p>Grass grows slowly in winter. In those months we focus on weeding, edging and tidying instead of cutting.</p>
        <p>You will be told which days are your service days. We keep to the same days each month where we can.</p>
      </Section>

      <Section number="3" title="What you pay">
        <List
          items={["Monthly: R200 per month", "Annual: R2,000 for twelve months (two months free)", "Once-off visit: R280"]}
        />
        <p>Payment is by debit order through PayFast. The monthly amount comes off automatically on the same date each month.</p>
        <p>
          <span className="font-medium text-navy">Launch offer:</span> the first 50 customers get their second month
          free. You pay the normal price when you sign up, and we refund your second month&apos;s payment once it is
          due.
        </p>
      </Section>

      <Section number="4" title="If your payment fails">
        <p>If your payment does not go through, we will contact you on WhatsApp.</p>
        <p>
          You have <span className="font-medium text-navy">7 days</span> to sort it out. If it is not paid after 7
          days, we stop the service until payment is up to date. We do not owe you visits that were missed while you
          were unpaid.
        </p>
      </Section>

      <Section number="5" title="Cancelling">
        <p>
          <span className="font-medium text-navy">Monthly customers:</span> you can cancel any time. Give us 7 days'
          notice on WhatsApp. You will not be charged again after that.
        </p>
        <p>
          <span className="font-medium text-navy">Annual customers:</span> you have paid for the full year. If you
          cancel early, we do not refund the unused months. This is why the annual price is cheaper.
        </p>
        <p>We can also cancel the service if you do not keep to these terms. We will tell you why.</p>
      </Section>

      <Section number="6" title="Getting into your yard">
        <p className="font-medium text-navy">This is important. Please read it.</p>
        <p>For us to do the work, on your service day:</p>
        <List
          items={[
            "The gate must be unlocked or we must have a key",
            "Dogs must be tied up, locked inside, or in a separate area",
            "Cars, furniture and loose items should be moved off the grass",
            "Small items — toys, tools, shoes, phones, washing — must be picked up",
          ]}
        />
        <p>
          <span className="font-medium text-navy">We will send you a WhatsApp reminder the day before.</span> That is
          your notice to unlock and secure the dogs.
        </p>
        <p>
          If we arrive and cannot get in, or dogs are loose, or the yard is not clear,{" "}
          <span className="font-medium text-navy">that visit counts as done.</span> We cannot come back for free. Our
          worker travelled and lost the time slot.
        </p>
        <p>If you know you will not be ready, tell us on WhatsApp before the day and we will move you.</p>
      </Section>

      <Section number="7" title="Your belongings">
        <p>We are not responsible for anything left outside on your grass or yard.</p>
        <p>
          That means phones, laptops, keys, jewellery, clothing, tools, toys, or anything else. Machines throw
          stones and cut what is in the grass. We cannot see small items.
        </p>
        <p>
          <span className="font-medium text-navy">If it is on the lawn, it is at your risk.</span> Pick it up before
          your service day.
        </p>
        <p>Claims about items left outside will not be paid.</p>
      </Section>

      <Section number="8" title="If we damage something">
        <p>We work carefully, but accidents happen.</p>
        <p>
          <span className="font-medium text-navy">We will pay for damage</span> we cause to fixed things in the yard
          — a broken tap, a cracked paving slab, a damaged light — where it is clearly our fault.
        </p>
        <p>
          <span className="font-medium text-navy">You must tell us within 48 hours</span> of the visit, with photos.
          After 48 hours we cannot tell whether it was us.
        </p>
        <p className="font-medium text-navy">We do not pay for:</p>
        <List
          items={[
            "Items left loose on the grass (see section 7)",
            "Damage that was already there",
            "Plants or grass that die from weather, disease or lack of water",
            "Damage from things hidden under grass that we could not see — pipes, wires, sprinkler heads — unless you told us about them in writing beforehand",
          ]}
        />
        <p>Please tell us in advance where your irrigation, wiring or pipes run.</p>
      </Section>

      <Section number="9" title="Our workers">
        <List
          items={[
            "Every worker carries an OGP Services staff ID card and wears OGP Services uniform",
            "Workers stay in the yard area only. They do not enter your house",
            "Workers do not ask customers for money, food or favours",
            "If a worker behaves badly, tell us on WhatsApp immediately",
          ]}
        />
        <p>
          Please do not ask our workers to do extra jobs directly. Send the request to us so it is recorded and
          priced properly.
        </p>
      </Section>

      <Section number="10" title="Rain and things we cannot control">
        <p>
          If it rains on your service day, or the weather makes work unsafe, we move you to the next working day. No
          refund is due for a moved visit.
        </p>
        <p>The same applies to community unrest, road closures, or anything else outside our control.</p>
      </Section>

      <Section number="11" title="Complaints">
        <p>
          If you are not happy with the work, tell us on WhatsApp{" "}
          <span className="font-medium text-navy">within 48 hours</span> with a photo.
        </p>
        <p>If the complaint is fair, we come back and fix it at no charge.</p>
        <p>This is how we keep the service good. Please tell us.</p>
      </Section>

      <Section number="12" title="Your information">
        <p>We keep your name, house number, WhatsApp number and payment record.</p>
        <p>We use it only to run the service. We do not sell it or give it to anyone else.</p>
        <p>Card details are handled by PayFast. We never see or store your card number.</p>
      </Section>

      <Section number="13" title="Price changes">
        <p>
          We can change the price with <span className="font-medium text-navy">30 days' written notice</span> on
          WhatsApp.
        </p>
        <p>If you do not accept the new price, you can cancel before it starts.</p>
        <p>Annual customers keep their price until their year is finished.</p>
      </Section>

      <Section number="14" title="Agreement">
        <p>By signing up and paying, you accept these terms.</p>
        <p>These terms are governed by the laws of South Africa.</p>
      </Section>

      <footer className="border-t border-navy/10 pt-10">
        <p className="text-sm font-medium text-navy">Contact us</p>
        <p className="mt-2 text-sm text-navy/60">
          WhatsApp:{" "}
          <a href={WHATSAPP_LINK} className="text-navy underline underline-offset-2">
            {WHATSAPP_DISPLAY}
          </a>
          <br />
          {COMPANY_NAME}, Platinum Village, Rustenburg
        </p>
        <Link href="/" className="mt-8 inline-block text-sm text-navy underline underline-offset-2">
          Back to signup
        </Link>
      </footer>
    </main>
  );
}
