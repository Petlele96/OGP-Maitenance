# OGP Services - Yard Maintenance Signup

Single mobile-first page for customers in Platinum Village, Rustenburg to sign up for
recurring yard maintenance (R200/month or R2,000/year) and pay via a PayFast recurring
subscription. No login. Signups are only marked `active` once PayFast's ITN webhook
confirms the payment - never on the strength of the browser redirect alone.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Postgres via `@neondatabase/serverless` (works with Neon or Vercel Postgres, which is
  Neon-backed)
- PayFast recurring billing (Custom Integration / hosted checkout redirect)

## Local setup

```bash
npm install
cp .env.example .env.local
```

`.env.local` ships pointing at PayFast's public **sandbox** credentials, so you can test
the whole flow without a real merchant account. You still need a real Postgres database -
create one (e.g. at neon.com, or via Vercel's Storage tab) and put its connection string in
`DATABASE_URL`.

Create the `signups` table:

```bash
npm run db:migrate
```

Run the dev server:

```bash
npm run dev
```

### Testing the PayFast flow locally

PayFast's ITN webhook (`notify_url`) needs a **publicly reachable** URL - it can't reach
`localhost`. To test the full loop locally, tunnel your dev server (e.g. `ngrok http 3000`)
and set `NEXT_PUBLIC_BASE_URL` to the tunnel's HTTPS URL before submitting the form. The
simplest way to test end-to-end, though, is a Vercel preview deploy, which already has a
public URL - see below.

## Deploying to Vercel

1. Push this repo to GitHub and import it into Vercel.
2. In the Vercel project, add a Postgres database (Storage tab -> Postgres, which
   provisions a Neon database) or connect an existing Neon database. Vercel sets
   `DATABASE_URL` (or `POSTGRES_URL` - if you get that instead, add a `DATABASE_URL` env
   var pointing at the same value) automatically.
3. Set the remaining environment variables in Vercel (Project Settings -> Environment
   Variables):
   - `PAYFAST_MERCHANT_ID`
   - `PAYFAST_MERCHANT_KEY`
   - `PAYFAST_PASSPHRASE`
   - `PAYFAST_MODE` (`sandbox` until you're ready to go live)
   - `NEXT_PUBLIC_BASE_URL` (your Vercel deployment URL, e.g.
     `https://ogp-services.vercel.app`)
4. Deploy. Then run the migration against the production database once:
   ```bash
   DATABASE_URL="<production connection string>" npm run db:migrate
   ```
5. Test a full sandbox signup on your phone against the deployed URL. Confirm the row in
   `signups` flips from `pending` to `active` and `payfast_subscription_token` is filled
   in.

## Going live

1. Get OGP Services' real PayFast merchant ID and merchant key from the PayFast merchant
   dashboard, and set a passphrase under Settings -> Integration on that account (it must
   match `PAYFAST_PASSPHRASE`).
2. Confirm Recurring Billing is enabled on the merchant account (PayFast may require this
   to be switched on by their support team).
3. In Vercel, update `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` to
   the real values and set `PAYFAST_MODE=live`. Redeploy.
4. Do one real, low-value signup on a phone against the live site. Confirm:
   - The PayFast checkout shows OGP Services' real merchant name, not "sandbox".
   - After completing payment, `/thank-you` shows "You're all set!".
   - The corresponding row in `signups` has `payment_status = 'active'` and a populated
     `payfast_subscription_token`.

## Data model

One table, `signups` (see `db/schema.sql`):

| column                        | notes                                              |
| ------------------------------ | --------------------------------------------------- |
| `full_name`                    |                                                     |
| `house_number`                 |                                                     |
| `whatsapp_number`               | normalized to `0XXXXXXXXX`                          |
| `plan`                          | `monthly` or `annual`                              |
| `amount`                        | plan price at signup time                          |
| `start_date`                    | set when the subscription is confirmed active      |
| `payment_status`                | `pending` -> `active` (or `failed` / `cancelled`)   |
| `payfast_subscription_token`    | PayFast's token for this subscription (from ITN)   |
| `payfast_m_payment_id`          | our reference PayFast echoes back on every ITN call |

## How the PayFast integration works

PayFast's interactive docs site is a JS single-page app that doesn't expose readable
content to fetchers, so this integration was built directly from PayFast's official PHP
SDK (`github.com/Payfast/payfast-php-sdk`), ported to TypeScript in `lib/payfast.ts`:

- **Checkout** (`lib/payfast.ts` `buildCheckoutFields`): builds a signed set of hidden form
  fields for a `subscription_type=1` recurring billing checkout and the browser POSTs them
  straight to PayFast's hosted payment page (`/api/signup` route + the hidden form in
  `app/page.tsx`).
- **ITN webhook** (`app/api/payfast/itn/route.ts` + `verifyItn` in `lib/payfast.ts`):
  reproduces PayFast's four ITN checks - signature match, source-host check (logged but
  non-fatal, since IP allowlists are brittle behind proxies/CDNs), merchant/amount match,
  and PayFast's own server-side "VALID" confirmation call (the authoritative check). A
  signup is only ever activated here, never from the `return_url` the browser lands on.

## Known limitations / not built

- No subscription management (pause/cancel/update) UI - PayFast's Subscriptions API
  supports this if needed later, but it wasn't in scope.
- No admin view of signups - query the database directly for now.
