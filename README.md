# StockScope V2

StockScope V2 upgrades the original visual prototype into a real historical-data architecture with a proper recurring-investment engine.

## What changed

- Major visual redesign
- Responsive desktop/mobile experience
- Real server-side market-data proxy
- API key stays server-side
- Adjusted historical close support
- Daily, weekly and monthly recurring investment schedules
- Weekend / market-holiday cash rolls to the next trading session
- Fractional-share accumulation
- Uninvested cash at the end of the selected period is preserved
- Portfolio-value vs cumulative-contribution chart
- Saved simulations in browser storage
- Methodology page explaining the calculation
- Fundamentals / similarity section prepared for the next milestone

## Market data

The included adapter uses **EODHD** end-of-day historical data and consumes `adjusted_close`.

The provider is deliberately isolated in `server.js`, so it can later be replaced by Twelve Data, Alpha Vantage, Massive/Polygon or a commercial feed without rewriting the investment engine.

## Start locally

You need Node.js 18 or newer.

1. Create an EODHD API key.
2. Copy `.env.example` to `.env`.
3. Add your key:

```env
EODHD_API_KEY=YOUR_KEY
```

4. Run:

```bash
npm start
```

5. Open:

```text
http://localhost:3000
```

The project uses Stripe's official server library for subscription billing.

## DCA methodology

For a selected date range and contribution frequency:

1. Generate all scheduled contribution dates.
2. Load daily adjusted historical closes.
3. On each trading session, queue every contribution whose scheduled date has passed.
4. Buy fractional shares with all queued cash at that session's adjusted close.
5. Track cumulative invested cash, shares and portfolio value.
6. Contributions scheduled after the last available trading session remain as cash in the ending value.

Example: if £6/day is selected and Saturday + Sunday are non-trading days, those contributions are queued and invested with Monday's contribution on the next available session.

## Important assumptions

- Contributions are converted using historical GBP/USD closes before fractional shares are purchased.
- Brokerage fees, spreads, tax and withholding tax are not yet included.
- Adjusted-close methodology depends on the market-data provider.
- Similarity, allocation and alert outputs are mechanical research signals, not investment advice or forecasts.

## Private-beta deployment (Render)

The repository-root `render.yaml` defines the Node web service, production health check, build tests and required secrets.

1. Push the repository to a private GitHub repository.
2. In Render, select **New → Blueprint** and connect the repository.
3. Enter the secret environment variables requested by the Blueprint: `EODHD_API_KEY`, `SEC_USER_AGENT`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `BETA_USERNAME`, and `BETA_PASSWORD`.
4. Deploy and verify that `/api/health` returns `status: ok`.
5. Add the Render URL to Supabase Authentication → URL Configuration as the Site URL and an allowed redirect URL.

`PRIVATE_BETA=true` enables HTTP Basic authentication for every route except the health check. Render terminates HTTPS before forwarding requests. Disable private-beta authentication only when the product is ready for public access.

## Stripe Pro subscriptions

Billing is safely dormant while `BILLING_ENABLED=false`. To test Pro subscriptions:

1. Re-run `supabase/schema.sql` in the Supabase SQL editor to add the Stripe profile columns.
2. In Stripe test mode, create a StockScope Pro product with a recurring GBP price.
3. Add `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and the recurring `STRIPE_PRO_PRICE_ID` to the server environment. Never expose these in browser code.
4. Create a Stripe webhook endpoint at `https://stockscope-private-beta.onrender.com/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`; then add its signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Set `APP_URL` to the deployed HTTPS origin and change `BILLING_ENABLED` to `true`.

Checkout and the customer portal are created server-side. Supabase plan access changes only after a webhook has passed Stripe signature verification.

## Structure

```text
stockscope_v2/
├── package.json
├── server.js
├── .env.example
├── README.md
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```
