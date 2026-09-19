# An invoice, a quote, a receipt

Write the facts as JSON; the script works out every sum in the currency's smallest unit, lays
the document out and prints it. Never add up an invoice yourself.

```bash
$D invoice <data.json> [--out invoice-2026-014]
```

It prints the subtotal, tax and total it worked out (say them in your answer), the HTML it
printed from, and the PDF with its picture.

```json
{
  "kind": "invoice",
  "number": "INV-2026-014",
  "date": "20 September 2026",
  "due": "20 October 2026",
  "currency": "USD",
  "locale": "en-US",
  "from": {
    "name": "Northwind Studio LLC",
    "address": ["148 Mercer Street, Suite 4", "New York, NY 10012"],
    "email": "billing@northwind.studio",
    "phone": "+1 212 555 0148",
    "tax_id": "EIN 84-2931770",
    "logo": "path/to/logo.png"
  },
  "to": {
    "name": "Acme Robotics Inc.",
    "attn": "Attn: Dana Whitfield, Finance",
    "address": ["2200 Mission College Blvd", "Santa Clara, CA 95054"],
    "email": "ap@acme.example"
  },
  "items": [
    { "description": "Brand identity system", "detail": "Logo, type, colour, usage guide", "quantity": 1, "price": 8500 },
    { "description": "Design support", "detail": "September, billed hourly", "quantity": 14.5, "unit": "h", "price": 120 }
  ],
  "tax": { "rate": "8.875%", "label": "Sales tax" },
  "payment": { "Bank": "First Bank", "Account": "0048 2291 7710", "Terms": "Net 30" },
  "notes": "Please include the invoice number with your payment.",
  "thanks": "Thank you for your business."
}
```

- `kind`: `invoice`, `quote` (takes `valid_until` instead of `due`) or `receipt` (shows what was paid).
- `number` continues the user's own series: the next after the last one you kept. With no series
  yet, start one (`2026-001`) and say so in your answer.
- `currency` is a three-letter code; `locale` decides how amounts are written (`ko-KR` gives ₩1,200,000,
  `de-DE` gives 1.200,00 €). `language` (`en ko ja zh de fr es`) sets the labels, taken from `locale`
  when missing; `labels` overrides any of them by key (`{"tax": "VAT"}`).
- A rate is `"10%"` or `0.1`. `tax.inclusive: true` when prices already include it (common for
  consumer prices in Korea, Japan and the EU): the tax is then shown, not added. An item's own
  `tax` overrides the rate for that line; lines at different rates get one tax line each.
- `discount` on an item or on the whole: an amount, or `"10%"`. `shipping` and `paid` are amounts;
  with `paid`, the bottom line is the balance due.
- `accent` is a colour for the title and total; `title` replaces the word at the top.

A Korean 세금계산서 or a Japanese 適格請求書 has fields the law fixes (registration numbers, the
tax per rate): put them in `from.tax_id`, `labels` and `notes`, and say in your answer that it is
a document for the customer, not the one filed with the tax office.

What the data cannot say — a stamp image, a second table, a custom footer — is an edit to the
HTML it printed from, then `$D pdf <that html>`.
