// An invoice, quote or receipt from JSON: every sum worked out here in minor units, never
// by the model, then laid out as HTML and printed to PDF.
import { copyFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { printPdf } from "./browser.mjs";
import {
  escapeHtml as esc,
  input,
  output,
  readJson,
  Stop,
  shown,
} from "./kit.mjs";
import { printCss } from "./templates.mjs";

const LABELS = {
  en: {
    invoice: "Invoice",
    quote: "Quote",
    receipt: "Receipt",
    number: "No.",
    date: "Date",
    due: "Due",
    valid: "Valid until",
    from: "From",
    to: "Bill to",
    quoteTo: "Prepared for",
    item: "Description",
    qty: "Qty",
    price: "Unit price",
    amount: "Amount",
    subtotal: "Subtotal",
    discount: "Discount",
    shipping: "Shipping",
    tax: "Tax",
    total: "Total",
    paid: "Paid",
    balance: "Amount due",
    payment: "Payment",
    notes: "Notes",
    taxId: "Tax ID",
  },
  ko: {
    invoice: "청구서",
    quote: "견적서",
    receipt: "영수증",
    number: "번호",
    date: "발행일",
    due: "지급 기한",
    valid: "유효 기간",
    from: "공급자",
    to: "청구 대상",
    quoteTo: "수신",
    item: "품목",
    qty: "수량",
    price: "단가",
    amount: "금액",
    subtotal: "공급가액",
    discount: "할인",
    shipping: "배송비",
    tax: "부가세",
    total: "합계",
    paid: "입금액",
    balance: "청구 금액",
    payment: "입금 계좌",
    notes: "비고",
    taxId: "사업자등록번호",
  },
  ja: {
    invoice: "請求書",
    quote: "御見積書",
    receipt: "領収書",
    number: "番号",
    date: "発行日",
    due: "お支払期限",
    valid: "有効期限",
    from: "発行元",
    to: "請求先",
    quoteTo: "宛先",
    item: "品目",
    qty: "数量",
    price: "単価",
    amount: "金額",
    subtotal: "小計",
    discount: "値引き",
    shipping: "送料",
    tax: "消費税",
    total: "合計",
    paid: "入金額",
    balance: "ご請求金額",
    payment: "お振込先",
    notes: "備考",
    taxId: "登録番号",
  },
  zh: {
    invoice: "发票",
    quote: "报价单",
    receipt: "收据",
    number: "编号",
    date: "日期",
    due: "付款期限",
    valid: "有效期至",
    from: "开票方",
    to: "付款方",
    quoteTo: "致",
    item: "项目",
    qty: "数量",
    price: "单价",
    amount: "金额",
    subtotal: "小计",
    discount: "折扣",
    shipping: "运费",
    tax: "税",
    total: "合计",
    paid: "已付",
    balance: "应付金额",
    payment: "付款信息",
    notes: "备注",
    taxId: "税号",
  },
  de: {
    invoice: "Rechnung",
    quote: "Angebot",
    receipt: "Quittung",
    number: "Nr.",
    date: "Datum",
    due: "Fällig am",
    valid: "Gültig bis",
    from: "Von",
    to: "Rechnung an",
    quoteTo: "Für",
    item: "Beschreibung",
    qty: "Menge",
    price: "Einzelpreis",
    amount: "Betrag",
    subtotal: "Zwischensumme",
    discount: "Rabatt",
    shipping: "Versand",
    tax: "USt.",
    total: "Gesamt",
    paid: "Bezahlt",
    balance: "Offener Betrag",
    payment: "Zahlung",
    notes: "Hinweise",
    taxId: "USt-IdNr.",
  },
  fr: {
    invoice: "Facture",
    quote: "Devis",
    receipt: "Reçu",
    number: "N°",
    date: "Date",
    due: "Échéance",
    valid: "Valable jusqu’au",
    from: "De",
    to: "Facturé à",
    quoteTo: "Pour",
    item: "Désignation",
    qty: "Qté",
    price: "Prix unitaire",
    amount: "Montant",
    subtotal: "Sous-total",
    discount: "Remise",
    shipping: "Livraison",
    tax: "TVA",
    total: "Total",
    paid: "Payé",
    balance: "Montant dû",
    payment: "Paiement",
    notes: "Notes",
    taxId: "N° TVA",
  },
  es: {
    invoice: "Factura",
    quote: "Presupuesto",
    receipt: "Recibo",
    number: "N.º",
    date: "Fecha",
    due: "Vencimiento",
    valid: "Válido hasta",
    from: "De",
    to: "Facturar a",
    quoteTo: "Para",
    item: "Descripción",
    qty: "Cant.",
    price: "Precio unitario",
    amount: "Importe",
    subtotal: "Subtotal",
    discount: "Descuento",
    shipping: "Envío",
    tax: "IVA",
    total: "Total",
    paid: "Pagado",
    balance: "Importe pendiente",
    payment: "Pago",
    notes: "Notas",
    taxId: "NIF",
  },
};

const KINDS = ["invoice", "quote", "receipt"];

const number = (value, what) => {
  const n = typeof value === "string" ? Number(value.replace(/,/g, "")) : value;
  if (typeof n !== "number" || !Number.isFinite(n))
    throw new Stop(`${what} is not a number: ${JSON.stringify(value)}`);
  return n;
};

/** A rate as a fraction: 10, "10%" and 0.1 are all ten percent. */
const rate = (value, what) => {
  if (value == null) return 0;
  const n = number(String(value).replace("%", ""), what);
  return n > 1 ? n / 100 : n;
};

function computeTotals(data) {
  const currency = String(data.currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Stop(
      'Set "currency" to a three-letter code: USD, EUR, KRW, JPY…',
    );
  const locale = data.locale ?? "en-US";
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  const digits = money.resolvedOptions().maximumFractionDigits;
  const unit = 10 ** digits;
  // Every amount is a whole number of the currency's smallest unit
  const minor = (n) => Math.round(n * unit + Number.EPSILON);
  const show = (m) => money.format(m / unit);
  // A unit price may carry more decimals than the currency's smallest unit: 0.125 per item
  const price = (n) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: Math.max(digits, 4),
    }).format(n);
  if (!Array.isArray(data.items) || !data.items.length)
    throw new Stop('"items" is a list of { description, quantity, price }.');
  const defaultTax =
    data.tax == null ? 0 : rate(data.tax.rate ?? data.tax, "tax rate");
  const inclusive = Boolean(data.tax?.inclusive);

  const lines = data.items.map((item, i) => {
    if (!item.description)
      throw new Stop(`Item ${i + 1} has no "description".`);
    const qty = number(item.quantity ?? 1, `Item ${i + 1} quantity`);
    const price = number(item.price, `Item ${i + 1} price`);
    const gross = minor(qty * price);
    const off = item.discount
      ? String(item.discount).includes("%") || Number(item.discount) < 1
        ? minor((gross / unit) * rate(item.discount, "discount"))
        : minor(number(item.discount, "discount"))
      : 0;
    return {
      ...item,
      qty,
      price,
      amount: gross - off,
      off,
      taxRate:
        item.tax == null ? defaultTax : rate(item.tax, `Item ${i + 1} tax`),
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const discount = data.discount
    ? String(data.discount).includes("%")
      ? minor((subtotal / unit) * rate(data.discount, "discount"))
      : minor(number(data.discount, "discount"))
    : 0;
  // The order discount is shared across lines in proportion, so each tax rate is charged on what is left
  const byRate = new Map();
  for (const line of lines) {
    const share = subtotal
      ? line.amount - (discount * line.amount) / subtotal
      : 0;
    byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + share);
  }
  const taxes = [...byRate]
    .filter(([r]) => r > 0)
    .map(([r, base]) => ({
      rate: r,
      amount: inclusive
        ? Math.round(base - base / (1 + r))
        : Math.round(base * r),
    }));
  const tax = taxes.reduce((s, t) => s + t.amount, 0);
  const shipping = data.shipping ? minor(number(data.shipping, "shipping")) : 0;
  const total = subtotal - discount + (inclusive ? 0 : tax) + shipping;
  const paid = data.paid ? minor(number(data.paid, "paid")) : 0;
  return {
    currency,
    locale,
    show,
    price,
    qtyFormat: new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }),
    lines,
    subtotal,
    discount,
    taxes,
    tax,
    inclusive,
    shipping,
    total,
    paid,
    balance: total - paid,
  };
}

const lines = (value) =>
  (Array.isArray(value) ? value : value ? String(value).split("\n") : [])
    .filter(Boolean)
    .map(esc)
    .join("<br>");

/** The sender's own lines under their name, smaller: address, then how to reach them. */
function fromLines(p, L) {
  if (!p) return "";
  return [
    p.tagline ? esc(p.tagline) : "",
    lines(p.address),
    [p.email, p.phone, p.website].filter(Boolean).map(esc).join(" · "),
    p.tax_id ? `${L.taxId} ${esc(p.tax_id)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
}

function party(p, L) {
  if (!p) return "";
  const rest = [
    p.attn ? esc(p.attn) : "",
    lines(p.address),
    p.email ? esc(p.email) : "",
    p.phone ? esc(p.phone) : "",
    p.tax_id ? `${L.taxId} ${esc(p.tax_id)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
  return `<strong>${esc(p.name)}</strong>${rest ? `<br><span class="muted">${rest}</span>` : ""}`;
}

const percent = (r, locale) =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 3,
  }).format(r);

function invoiceHtml(data, t, logo) {
  const kind = KINDS.includes(data.kind) ? data.kind : "invoice";
  const lang = String(data.language ?? data.locale ?? "en")
    .slice(0, 2)
    .toLowerCase();
  const L = { ...(LABELS[lang] ?? LABELS.en), ...(data.labels ?? {}) };
  const title = data.title ?? L[kind];
  const rows = t.lines
    .map(
      (l, i) => `<tr>
  <td class="n">${i + 1}</td>
  <td><div class="desc">${esc(l.description)}</div>${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ""}</td>
  <td class="num">${t.qtyFormat.format(l.qty)}${l.unit ? ` <span class="muted">${esc(l.unit)}</span>` : ""}</td>
  <td class="num">${t.price(l.price)}</td>
  <td class="num">${t.show(l.amount)}${l.off ? `<div class="detail">−${t.show(l.off)}</div>` : ""}</td>
</tr>`,
    )
    .join("\n");
  const sums = [
    [L.subtotal, t.subtotal],
    t.discount ? [L.discount, -t.discount] : null,
    ...t.taxes.map((x) => [
      `${data.tax?.label ?? L.tax} ${percent(x.rate, t.locale)}${t.inclusive ? " incl." : ""}`,
      x.amount,
    ]),
    t.shipping ? [L.shipping, t.shipping] : null,
  ].filter(Boolean);
  const due =
    kind === "quote"
      ? data.valid_until
        ? [L.valid, data.valid_until]
        : null
      : data.due
        ? [L.due, data.due]
        : null;
  const payment = data.payment
    ? typeof data.payment === "string"
      ? esc(data.payment)
      : Object.entries(data.payment)
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
          .join("")
    : "";
  const bottomLine =
    kind === "receipt" ? L.paid : kind === "quote" ? L.total : L.balance;
  const bottomValue = kind === "receipt" ? t.total : t.balance;
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<title>${esc(`${title} ${data.number ?? ""}`.trim())}</title>
<style>
${printCss().trim()}
</style>
<style>
:root { --accent: ${esc(data.accent ?? "#1f4e79")}; }
@page { margin: 16mm 16mm 18mm; }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20pt; margin-bottom: 26pt; }
.brand { display: flex; gap: 12pt; align-items: flex-start; }
.brand .from { font-size: 8.5pt; color: var(--soft); line-height: 1.5; margin-top: 4pt; }
.brand img { max-height: 40pt; max-width: 120pt; object-fit: contain; }
.brand .name { font-size: 13pt; font-weight: 700; letter-spacing: -0.01em; }
.doc { text-align: right; }
.doc h1 { font-size: 24pt; font-weight: 650; color: var(--accent); letter-spacing: -0.02em; }
.doc .no { color: var(--soft); margin-top: 3pt; font-size: 9.5pt; white-space: nowrap; }
.meta { display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 18pt; padding: 12pt 0 14pt; border-top: 0.75pt solid var(--rule); border-bottom: 0.75pt solid var(--rule); margin-bottom: 18pt; line-height: 1.45; }
.dates div + div { margin-top: 6pt; }
.owed { text-align: right; }
.owed b { display: block; font-size: 17pt; font-weight: 700; color: var(--accent); letter-spacing: -0.01em; margin-top: 2pt; }
.items td.n { color: var(--faint); width: 18pt; }
.items .desc { font-weight: 550; }
.items .detail { color: var(--soft); font-size: 8.5pt; margin-top: 1pt; }
.items th.num, .items td.num { width: 1%; padding-left: 14pt; }
.sums { display: flex; justify-content: flex-end; margin-top: 4pt; break-inside: avoid; }
.sums table { width: 46%; margin: 0; }
.sums td { border: 0; padding: 3pt 0; }
.sums td.num { padding-left: 16pt; }
.sums tr.grand td { border-top: 1pt solid var(--ink); padding-top: 8pt; font-size: 12.5pt; font-weight: 700; }
.sums tr.grand td.num { color: var(--accent); }
.foot { display: grid; grid-template-columns: 1fr 1fr; gap: 20pt; margin-top: 30pt; break-inside: avoid; }
.foot table { margin: 0; font-size: 9pt; }
.foot th { text-transform: none; letter-spacing: 0; font-size: 9pt; color: var(--soft); font-weight: 500; border: 0; padding: 1.5pt 10pt 1.5pt 0; white-space: nowrap; width: 1%; }
.foot td { border: 0; padding: 1.5pt 0; }
.thanks { margin-top: 26pt; color: var(--soft); font-size: 9pt; }
</style>
</head>
<body>
<div class="top">
  <div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ""}<div><div class="name">${esc(data.from?.name ?? "")}</div><div class="from">${fromLines(data.from, L)}</div></div></div>
  <div class="doc"><h1>${esc(title)}</h1>${data.number ? `<div class="no">${esc(L.number)} ${esc(data.number)}</div>` : ""}</div>
</div>

<div class="meta">
  <div><div class="label">${esc(kind === "quote" ? L.quoteTo : L.to)}</div>${party(data.to, L)}</div>
  <div class="dates">
    ${data.date ? `<div><div class="label">${esc(L.date)}</div>${esc(data.date)}</div>` : ""}
    ${due ? `<div><div class="label">${esc(due[0])}</div>${esc(due[1])}</div>` : ""}
  </div>
  <div class="owed"><div class="label">${esc(bottomLine)}</div><b>${t.show(bottomValue)}</b></div>
</div>

<table class="items">
  <thead><tr><th>#</th><th>${esc(L.item)}</th><th class="num">${esc(L.qty)}</th><th class="num">${esc(L.price)}</th><th class="num">${esc(L.amount)}</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>

<div class="sums"><table>
${sums.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v < 0 ? `−${t.show(-v)}` : t.show(v)}</td></tr>`).join("\n")}
<tr class="${t.paid ? "" : "grand"}"><td>${esc(L.total)}</td><td class="num">${t.show(t.total)}</td></tr>
${t.paid ? `<tr><td>${esc(L.paid)}</td><td class="num">−${t.show(t.paid)}</td></tr><tr class="grand"><td>${esc(L.balance)}</td><td class="num">${t.show(t.balance)}</td></tr>` : ""}
</table></div>

${
  payment || data.notes
    ? `<div class="foot">
  <div>${payment ? `<div class="label">${esc(L.payment)}</div>${typeof data.payment === "string" ? `<p>${payment}</p>` : `<table>${payment}</table>`}` : ""}</div>
  <div>${data.notes ? `<div class="label">${esc(L.notes)}</div><p>${lines(data.notes)}</p>` : ""}</div>
</div>`
    : ""
}
${data.thanks ? `<p class="thanks">${esc(data.thanks)}</p>` : ""}
</body>
</html>
`;
}

export async function invoice(dataPath, opts) {
  const data = readJson(dataPath);
  const t = computeTotals(data);
  const kind = KINDS.includes(data.kind) ? data.kind : "invoice";
  const stem = `${kind}-${data.number ?? data.to?.name ?? "draft"}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  const pdf = output(opts.out, stem, "pdf");
  const html = pdf.replace(/\.pdf$/, ".html");
  let logo = null;
  if (data.from?.logo) {
    const source = input(data.from.logo);
    logo = `${basename(html, ".html")}-logo${extname(source)}`;
    copyFileSync(source, join(dirname(html), logo));
  }
  writeFileSync(html, invoiceHtml(data, t, logo));
  const { broken, wide } = await printPdf(html, pdf);
  console.log(
    [
      `Subtotal ${t.show(t.subtotal)}${t.discount ? `, discount −${t.show(t.discount)}` : ""}${t.taxes.map((x) => `, tax ${Math.round(x.rate * 100000) / 1000}% ${t.show(x.amount)}${t.inclusive ? " (included)" : ""}`).join("")}${t.shipping ? `, shipping ${t.show(t.shipping)}` : ""}, total ${t.show(t.total)}${t.paid ? `, paid ${t.show(t.paid)}, due ${t.show(t.balance)}` : ""}.`,
      `${shown(html)} is the page it was printed from: edit it and run \`pdf\` on it for a change the data file cannot say.`,
    ].join("\n"),
  );
  const { report } = await import("./report.mjs");
  await report(pdf, { broken, wide });
}
