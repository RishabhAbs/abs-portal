import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, X, Printer, Save, Plus, Trash2, ArrowLeft, Landmark, Pencil, Download,
} from 'lucide-react';
import QRCode from 'qrcode';
import { vouchersApi, customersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

function useUpiQr(amount: number, vchNo: string, upiId: string, payeeName: string) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    if (!amount || !upiId) { setDataUrl(''); return; }
    const remark = `PAYMENT-${vchNo} ${payeeName} Rs.${Math.round(amount)}`;
    const upiStr = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName)}&am=${Math.round(amount)}&cu=INR&tn=${encodeURIComponent(remark)}`;
    QRCode.toDataURL(upiStr, { width: 200, margin: 1, errorCorrectionLevel: 'M' })
      .then(url => setDataUrl(url))
      .catch(() => setDataUrl(''));
  }, [amount, vchNo, upiId, payeeName]);
  return dataUrl;
}

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toInputDate = (d: Date) => d.toISOString().split('T')[0];
const displayDate = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
};
const addDays = (s: string, n: number) => {
  if (!s) return '';
  const d = new Date(s);
  d.setDate(d.getDate() + n);
  return toInputDate(d);
};

// Number-to-words for Indian numbering system. Used for "Amount in Words"
// at the bottom of the tax invoice.
function numberToWords(n: number): string {
  if (n == null || isNaN(n)) return '';
  const num = Math.round(Math.abs(n) * 100) / 100;
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

  const twoDigits = (x: number): string => {
    if (x < 20) return ones[x];
    return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
  };
  const threeDigits = (x: number): string => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? twoDigits(r) : '');
  };
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  let out = '';
  const crore = Math.floor(rupees / 10000000);
  const lakh  = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  if (crore)    out += twoDigits(crore) + ' Crore ';
  if (lakh)     out += twoDigits(lakh) + ' Lakh ';
  if (thousand) out += twoDigits(thousand) + ' Thousand ';
  if (rest)     out += threeDigits(rest);
  out = out.trim();
  if (out === '') out = 'Zero';
  let result = `${out} Rupees`;
  if (paise > 0) result += ` and ${twoDigits(paise)} Paise`;
  return result + ' Only';
}

type BankAccount = {
  id: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  branch: string;
  upi_id: string;
  // PNG data-URL of the (already cropped + resized) UPI QR code. Stored
  // inline in localStorage so it follows the bank record around without
  // needing a media-upload backend. Empty string when not configured.
  qr_image?: string;
};
type CompanyInfo = {
  name: string;
  address: string;
  email: string;
  phone: string;
  gstin: string;
  logo_url: string;
};

const COMPANY_KEY = 'print-voucher-company';
const BANKS_KEY   = 'print-voucher-banks';
const TERMS_KEY   = 'print-voucher-terms';
const ACTIVE_BANK_KEY = 'print-voucher-active-bank';

// Defaults match the sample tax invoice the user shared. They're stored in
// localStorage on first edit so the org doesn't have to re-enter every time.
const DEFAULT_COMPANY: CompanyInfo = {
  name:    'ABS Technologies',
  address: '1st Floor, Ram Kumar Plaza, A.T. Road,\nChatribari, Guwahati, Assam, 781001',
  email:   'accounts@abstechnologies.co.in',
  phone:   '9706050760',
  gstin:   '18ACMFA5628G1Z7',
  logo_url: '/logo.png',
};
const DEFAULT_BANK: BankAccount = {
  id: 'default',
  account_name:   'ABS Technologies',
  account_number: '50200117974614',
  ifsc:           'HDFC0004707',
  bank_name:      'HDFC Bank',
  branch:         'Paltan Bazar',
  upi_id:         'Vyapar.176885158996@hdfcbank',
  qr_image:       '',
};
const DEFAULT_TERMS = [
  'Payment of bill must be made within 7 Days.',
  'Services once activated are non-refundable.',
];

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return fallback;
}
const RETIRED_TERMS = new Set([
  'Subject to Guwahati Jurisdiction.',
  'This is a computer generated invoice and does not require physical signature.',
]);

function loadList<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        // Migrate old default bank UPI ID if still set to the old value
        let result = parsed.map((item: any) =>
          item.id === 'default' && item.upi_id === 'abstechnologies@hdfcbank'
            ? { ...item, upi_id: 'Vyapar.176885158996@hdfcbank' }
            : item
        );
        // Those two lines now render as their own footer text below the
        // signature block, so strip them out of any previously-saved terms list.
        if (key === TERMS_KEY) result = result.filter((t: any) => !RETIRED_TERMS.has(t));
        return (result.length ? result : fallback) as T[];
      }
    }
  } catch { /* ignore */ }
  return fallback;
}

export default function PrintVoucher() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showError, showSuccess } = useToast();

  const [company, setCompany] = useState<CompanyInfo>(() => loadJson(COMPANY_KEY, DEFAULT_COMPANY));
  const [banks, setBanks]     = useState<BankAccount[]>(() => loadList(BANKS_KEY, [DEFAULT_BANK]));
  const [activeBankId, setActiveBankId] = useState<string>(() => localStorage.getItem(ACTIVE_BANK_KEY) || 'default');
  const [terms, setTerms]     = useState<string[]>(() => loadList(TERMS_KEY, DEFAULT_TERMS));

  useEffect(() => { try { localStorage.setItem(COMPANY_KEY, JSON.stringify(company)); } catch {} }, [company]);
  useEffect(() => { try { localStorage.setItem(BANKS_KEY,   JSON.stringify(banks));   } catch {} }, [banks]);
  useEffect(() => { try { localStorage.setItem(TERMS_KEY,   JSON.stringify(terms));   } catch {} }, [terms]);
  useEffect(() => { try { localStorage.setItem(ACTIVE_BANK_KEY, activeBankId); } catch {} }, [activeBankId]);

  const activeBank = banks.find(b => b.id === activeBankId) || banks[0] || DEFAULT_BANK;

  // Voucher picker — search by vch_no / party. Debounced to avoid hammering
  // the API on every keystroke.
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerResults, setPickerResults] = useState<any[]>([]);
  const [pickerPage, setPickerPage] = useState(1);
  const PICKER_PAGE_SIZE = 10;
  const pickerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pickerOpen || search.trim().length < 2) {
      setPickerResults([]);
      return;
    }
    setPickerLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await vouchersApi.getAll({ search: search.trim(), limit: 200 });
        // Tax-invoice format only applies to Sales vouchers. Filter the
        // raw search hits down to those whose top-level type is "Sales"
        // (or that the user has explicitly named "Tax Invoice").
        const filtered = (res.data || []).filter((v: any) => {
          const parent  = String(v?.vch_parent_type_name || '').toLowerCase();
          const display = String(v?.vch_display_type     || '').toLowerCase();
          const type    = String(v?.vch_type_name        || '').toLowerCase();
          const subtype = String(v?.vch_subtype_name     || '').toLowerCase();
          return [parent, display, type, subtype].some(s => s === 'sales' || s === 'tax invoice');
        });
        setPickerResults(filtered);
        setPickerPage(1);
      } catch { /* ignore */ }
      finally { setPickerLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [search, pickerOpen]);

  // Selected voucher state. Hydrated from URL (?id=) or via the picker.
  const [voucher, setVoucher] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Tax-invoice format only applies to Sales-type vouchers (the parent or
  // any user-defined subtype of "Sales"). Anything else lacks the items
  // table + tax breakdown that a tax invoice needs.
  const isPrintableVoucherType = (v: any): boolean => {
    const parent  = String(v?.vch_parent_type_name || '').toLowerCase();
    const display = String(v?.vch_display_type     || '').toLowerCase();
    const type    = String(v?.vch_type_name        || '').toLowerCase();
    return [parent, display, type].some(s => s === 'sales' || s === 'tax invoice');
  };

  const [unsupportedVoucher, setUnsupportedVoucher] = useState<any>(null);
  const fetchVoucher = useCallback(async (id: number) => {
    setLoading(true);
    setUnsupportedVoucher(null);
    try {
      const res = await vouchersApi.getById(id);
      if (res.success) {
        if (isPrintableVoucherType(res.data)) {
          setVoucher(res.data);
        } else {
          // Stash the voucher metadata so we can tell the user which one
          // they tried to print, but don't render it as a tax invoice.
          setVoucher(null);
          setUnsupportedVoucher(res.data);
          showError(
            'Not a Sales voucher',
            `Print Voucher only supports Sales / Tax Invoice vouchers. This voucher is "${res.data.vch_type_name || res.data.vch_display_type || 'Unknown'}".`,
          );
        }
      }
    } catch { showError('Error', 'Failed to load voucher'); }
    finally { setLoading(false); }
  }, [showError]);

  useEffect(() => {
    const id = params.id ? parseInt(params.id, 10) : NaN;
    if (!isNaN(id)) fetchVoucher(id);
  }, [params.id, fetchVoucher]);

  // Editable invoice meta — derived from the loaded voucher but overridable.
  // Re-seeded whenever the voucher changes; user edits stick until they
  // pick a different voucher.
  const [meta, setMeta] = useState({
    invoice_no:       '',
    invoice_date:     '',
    due_date:         '',
    place_of_supply:  '',
    reverse_charge:   'No',
    payment_terms:    'Due within 15 Days',
    executive_name:   '',
    executive_phone:  '',
    remark:           '',
  });
  // Bill To (the buyer) — pre-filled from the customer master columns we
  // join on findById, but every field is overrideable from the sidebar so
  // the user can fix typos / fill gaps before printing without having to
  // edit the customer record. Values reset when the voucher changes.
  const [billTo, setBillTo] = useState({
    name:     '',
    address1: '',
    address2: '',
    city:     '',
    state:    '',
    pincode:  '',
    gstin:    '',
    phone:    '',
    email:    '',
    contact:  '',
  });
  useEffect(() => {
    if (!voucher) return;
    const inv = voucher.vch_date ? voucher.vch_date.split('T')[0] : toInputDate(new Date());
    setMeta({
      invoice_no:       voucher.vch_no || '',
      invoice_date:     inv,
      due_date:         addDays(inv, 15),
      place_of_supply:  voucher.party_state || 'Assam',
      reverse_charge:   'No',
      payment_terms:    'Due within 15 Days',
      executive_name:   '',
      executive_phone:  '',
      remark:           voucher.remark || '',
    });
    // Seed Bill To from whatever the voucher payload carried (just the
    // company name in the current backend), then fetch the full customer
    // record so the address / GST / phone / email rows populate. Done as
    // a separate fetch instead of joining at the voucher level so a
    // missing column on this DB instance can't crash voucher loading.
    setBillTo({
      name:     voucher.party_name           || '',
      address1: voucher.party_address1       || '',
      address2: voucher.party_address2       || '',
      city:     voucher.party_city           || '',
      state:    voucher.party_state          || '',
      pincode:  voucher.party_pincode ? String(voucher.party_pincode) : '',
      gstin:    voucher.party_gst            || '',
      phone:    voucher.party_mobile ? String(voucher.party_mobile) : '',
      email:    voucher.party_email          || '',
      contact:  voucher.party_contact_person || '',
    });
    if (voucher.party_ledger_id) {
      customersApi.getById(String(voucher.party_ledger_id))
        .then(res => {
          if (!res?.success || !res.data) return;
          const c = res.data;
          // Merge over the voucher-seeded values — only overwrite a field when
          // the customer record actually has a value, so a partial or empty
          // customer response never wipes billing details the voucher provided.
          setBillTo(prev => ({
            name:     c.company         || prev.name,
            address1: c.address1        || prev.address1,
            address2: c.address2        || prev.address2,
            // pincode_city is the joined name from the pincode table; fall
            // back to the raw c.city column the customer master sets.
            city:     c.pincode_city    || c.city || prev.city,
            state:    c.state_name      || c.state || prev.state,
            pincode:  c.pincode ? String(c.pincode) : prev.pincode,
            gstin:    c.gstin           || prev.gstin,
            phone:    c.mobile ? String(c.mobile) : prev.phone,
            email:    c.email           || prev.email,
            contact:  c.person          || c.contact_person || prev.contact,
          }));
        })
        .catch(() => { /* keep the voucher-provided billing details */ });
    }
  }, [voucher]);

  // Build the items list from the voucher's inventory entries (flattened
  // across all ledger entries). Voucher itself only has line-item data
  // when the voucher type is items-mode (Sales/Purchase), which is the
  // only case where a Tax Invoice makes sense anyway.
  const lineItems = useMemo(() => {
    if (!voucher?.ledgerEntries) return [];
    const items: Array<{
      description: string; sac: string; gst_rate: number;
      qty: number; rate: number; amount: number;
      cgst: number; sgst: number; igst: number;
    }> = [];
    // Reuse the voucher's IGST flag if set, otherwise infer from party state.
    const isIgst = !!voucher.is_igst
      || (voucher.party_state && voucher.party_state.toLowerCase() !== 'assam');
    for (const le of voucher.ledgerEntries || []) {
      for (const ie of le.inventoryEntries || []) {
        const qty    = Number(ie.qty)    || 0;
        const rate   = Number(ie.rate)   || 0;
        const amount = Math.abs(Number(ie.amount) || 0);
        const gstRate = Number(ie.gst_rate) || 0;
        const taxBase = amount;
        const cgst = isIgst ? 0 : +(taxBase * (gstRate / 2) / 100).toFixed(2);
        const sgst = isIgst ? 0 : +(taxBase * (gstRate / 2) / 100).toFixed(2);
        const igst = isIgst ? +(taxBase * gstRate / 100).toFixed(2) : 0;
        items.push({
          description: ie.item_name || '—',
          sac:         ie.hsn || '',
          gst_rate:    gstRate,
          qty:         Math.abs(qty),
          rate,
          amount:      taxBase,
          cgst, sgst, igst,
        });
      }
    }
    return items;
  }, [voucher]);

  const isIgstInvoice = useMemo(() =>
    lineItems.some(i => i.igst > 0)
    || (!!voucher?.party_state && voucher.party_state.toLowerCase() !== 'assam'),
    [lineItems, voucher],
  );

  const totals = useMemo(() => {
    const taxable = lineItems.reduce((s, i) => s + i.amount, 0);
    // Computed taxes are only the FALLBACK. The voucher's own ledger rows
    // are authoritative — they carry the saved CGST/SGST/IGST plus Round
    // Off and any other charge ledgers. Recomputing from items (the old
    // way) silently dropped Round Off, so the printed total didn't match
    // the voucher amount.
    let cgst = lineItems.reduce((s, i) => s + i.cgst, 0);
    let sgst = lineItems.reduce((s, i) => s + i.sgst, 0);
    let igst = lineItems.reduce((s, i) => s + i.igst, 0);
    const extras: { name: string; amount: number }[] = [];

    const entries: any[] = voucher?.ledgerEntries || [];
    const partyRow = entries.find((le: any) => String(le.ledger_id) === String(voucher?.party_ledger_id));
    // Ledger amounts are signed (+Dr/−Cr). On a sales-side voucher the
    // party is Dr and every charge row is Cr — its addition to the bill is
    // the negated amount. On credit-note side it flips. −partySign×amt
    // covers both.
    const partySign = Number(partyRow?.amount ?? 1) >= 0 ? 1 : -1;
    let sawTaxRows = false;
    let actCgst = 0, actSgst = 0, actIgst = 0;
    for (const le of entries) {
      if (le === partyRow) continue;
      if ((le.inventoryEntries?.length ?? 0) > 0) continue; // goods row = the items themselves
      const name = String(le.ledger_name || '').trim();
      const display = +(-partySign * Number(le.amount || 0)).toFixed(2);
      if (/^cgst$/i.test(name))      { actCgst += display; sawTaxRows = true; }
      else if (/^sgst$/i.test(name)) { actSgst += display; sawTaxRows = true; }
      else if (/^igst$/i.test(name)) { actIgst += display; sawTaxRows = true; }
      else if (display !== 0 || /round/i.test(name)) extras.push({ name: name || 'Other Charges', amount: display });
    }
    if (sawTaxRows) { cgst = actCgst; sgst = actSgst; igst = actIgst; }

    const extrasSum = extras.reduce((s, e) => s + e.amount, 0);
    const total = +(taxable + cgst + sgst + igst + extrasSum).toFixed(2);
    return {
      taxable: +taxable.toFixed(2),
      cgst:    +cgst.toFixed(2),
      sgst:    +sgst.toFixed(2),
      igst:    +igst.toFixed(2),
      extras,
      total,
    };
  }, [lineItems, voucher]);

  const handlePrint = () => {
    if (!voucher) return;
    window.print();
  };

  const invoiceRef = useRef<HTMLDivElement>(null);

  // Render the PDF from a detached deep-clone of the invoice — never the live,
  // React-managed node. html2pdf/html2canvas relocate + restyle whatever element
  // you hand them; letting that touch the live node (which also sits inside a
  // scrollable container) made the *second* download come out wrong, because
  // stale styles / scroll state carried over from the first run. Cloning per
  // call guarantees every download starts from the same pristine markup.
  const cloneInvoiceForRender = () => {
    const src = invoiceRef.current!;
    const clone = src.cloneNode(true) as HTMLElement;
    const holder = document.createElement('div');
    // Render at a FIXED A4-proportioned width, never the live node's
    // offsetWidth — inside the hidden download/share iframe that width is
    // near zero, and a collapsed clone is exactly what produced the
    // stretched, distorted PDFs. 794px = A4 width at 96dpi.
    const A4_PX = 794;
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_PX}px;background:#fff;`;
    clone.style.width = `${A4_PX}px`;
    clone.style.maxWidth = `${A4_PX}px`;
    clone.style.margin = '0';
    holder.appendChild(clone);
    document.body.appendChild(holder);
    return { clone, cleanup: () => { try { document.body.removeChild(holder); } catch { /* already gone */ } } };
  };

  const pdfOptions = (filename?: string) => ({
    margin: 0,
    ...(filename ? { filename } : {}),
    image: { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
  });

  const handleDownload = async () => {
    if (!voucher || !invoiceRef.current) return;
    const html2pdf = (await import('html2pdf.js')).default;
    const filename = `Invoice-${voucher.vch_no || voucher.id}.pdf`;
    const { clone, cleanup } = cloneInvoiceForRender();
    try {
      await html2pdf().set(pdfOptions(filename)).from(clone).save();
    } finally {
      cleanup();
    }
  };

  // Auto-download when navigated with ?download=1
  useEffect(() => {
    if (searchParams.get('download') === '1' && voucher && invoiceRef.current) {
      handleDownload();
    }
  }, [voucher, searchParams]);

  // Share mode (?share=1): render → PDF blob → upload to the backend →
  // hand the public token back to the opener (the Vouchers page runs this
  // page in a hidden iframe and waits for the message).
  const shareRanRef = useRef(false);
  useEffect(() => {
    if (searchParams.get('share') !== '1' || !voucher || !invoiceRef.current || shareRanRef.current) return;
    shareRanRef.current = true;
    (async () => {
      try {
        const html2pdf = (await import('html2pdf.js')).default;
        const { clone, cleanup } = cloneInvoiceForRender();
        let blob: Blob;
        try {
          blob = await html2pdf().set(pdfOptions()).from(clone).outputPdf('blob');
        } finally {
          cleanup();
        }
        const { vouchersApi: va } = await import('../services/api');
        const res = await va.uploadSharePdf(Number(voucher.id), blob);
        window.parent?.postMessage({
          type: 'voucher-share-ready',
          voucherId: Number(voucher.id),
          token: res.data.token,
          public_path: res.data.public_path,
        }, window.location.origin);
      } catch (e: any) {
        window.parent?.postMessage({
          type: 'voucher-share-error',
          voucherId: Number(voucher?.id),
          message: e?.message || 'Failed to prepare voucher PDF',
        }, window.location.origin);
      }
    })();
  }, [voucher, searchParams]);

  // Bill-To customer search — typeahead that lets the user override the
  // voucher's party with any customer in the system. On pick we fetch the
  // full record and overwrite every Bill To field so the address / GST /
  // contact info stays in sync.
  const [billToSearch, setBillToSearch] = useState('');
  const [billToOpen,   setBillToOpen]   = useState(false);
  const [billToResults, setBillToResults] = useState<any[]>([]);
  const [billToBusy, setBillToBusy] = useState(false);
  useEffect(() => {
    if (!billToOpen || billToSearch.trim().length < 2) {
      setBillToResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await customersApi.searchAllLedgers(billToSearch.trim());
        setBillToResults(res.data || []);
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [billToSearch, billToOpen]);
  const pickCustomer = async (c: any) => {
    setBillToOpen(false);
    setBillToSearch('');
    setBillToResults([]);
    setBillToBusy(true);
    try {
      // Pull the full customer record so we can fill every Bill To field
      // (the typeahead only returns id + company + group for speed).
      const res = await customersApi.getById(String(c.id));
      const full = res?.success ? res.data : null;
      if (!full) {
        // Fallback: at least take the name from the search hit.
        setBillTo(b => ({ ...b, name: c.company || '' }));
      } else {
        setBillTo({
          name:     full.company    || c.company || '',
          address1: full.address1   || '',
          address2: full.address2   || '',
          city:     full.city       || full.pincode_city || '',
          state:    full.state_name || full.state || '',
          pincode:  full.pincode ? String(full.pincode) : '',
          gstin:    full.gstin      || '',
          phone:    full.mobile ? String(full.mobile) : '',
          email:    full.email      || '',
          contact:  full.person     || full.contact_person || '',
        });
      }
    } catch {
      showError('Error', 'Failed to load customer details');
    } finally { setBillToBusy(false); }
  };

  // Bank manager — add / edit / delete saved bank accounts.
  const [bankEditorOpen, setBankEditorOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const blankBank = (): BankAccount => ({
    id: `bank-${Date.now()}`,
    account_name: '', account_number: '', ifsc: '', bank_name: '', branch: '', upi_id: '',
    qr_image: '',
  });
  // QR cropper state — holds the raw uploaded image (data URL) and the
  // resolved cropped output. Open=true while the cropper modal is up.
  const [qrCropperOpen, setQrCropperOpen] = useState(false);
  const [qrSourceUrl, setQrSourceUrl] = useState<string>('');
  const saveBank = (b: BankAccount) => {
    if (!b.account_name.trim() && !b.account_number.trim()) {
      showError('Validation', 'Bank needs at least an account name or number');
      return;
    }
    setBanks(prev => {
      const exists = prev.some(x => x.id === b.id);
      return exists ? prev.map(x => x.id === b.id ? b : x) : [...prev, b];
    });
    setActiveBankId(b.id);
    setBankEditorOpen(false);
    setEditingBank(null);
    showSuccess('Saved', 'Bank account saved');
  };
  const deleteBank = (id: string) => {
    if (!window.confirm('Remove this bank account from the saved list?')) return;
    setBanks(prev => prev.filter(b => b.id !== id));
    if (activeBankId === id) setActiveBankId(banks[0]?.id || 'default');
  };

  return (
    <div className="flex flex-col w-full bg-slate-100 fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto print:static print:h-auto print:bg-white print:block" style={{ overscrollBehavior: "contain" }}>
      {/* Toolbar — picker + print button. Hidden on print. */}
      <div className="no-print flex-none bg-slate-50 px-3 pt-2 pb-2 border-b border-slate-200 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 bg-white text-[12px] text-slate-600">
              <ArrowLeft size={12} /> Back
            </button>
            <h1 className="text-lg font-bold text-slate-800">Print Voucher</h1>
            {voucher && (
              <span className="text-[13px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                {voucher.vch_no || '—'} · {voucher.party_name || '—'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Voucher picker */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={pickerInputRef} value={search}
                onChange={e => { setSearch(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Search voucher no / party…"
                className="pl-7 pr-7 py-1.5 border border-slate-300 rounded text-[13px] w-72 outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
              {search && (
                <button onClick={() => { setSearch(''); setPickerResults([]); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
                  <X size={12} />
                </button>
              )}
              {pickerOpen && search.trim().length >= 2 && (
                <PickerDropdown
                  loading={pickerLoading}
                  results={pickerResults}
                  page={pickerPage} pageSize={PICKER_PAGE_SIZE}
                  onPickPage={setPickerPage}
                  onPick={(v) => {
                    setSearch(''); setPickerResults([]); setPickerOpen(false);
                    navigate(`/billing/print-voucher/${v.id}`);
                    fetchVoucher(v.id);
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
            <button onClick={handlePrint} disabled={!voucher}
              className="flex items-center gap-1 px-3 py-1.5 border border-blue-600 rounded hover:bg-blue-700 bg-blue-600 text-[12px] text-white disabled:opacity-40">
              <Printer size={12} /> Print
            </button>
            <button onClick={handleDownload} disabled={!voucher}
              className="flex items-center gap-1 px-3 py-1.5 border border-emerald-600 rounded hover:bg-emerald-700 bg-emerald-600 text-[12px] text-white disabled:opacity-40">
              <Download size={12} /> Download PDF
            </button>
          </div>
        </div>
      </div>

      {/* Body — left: editor, right: invoice preview. */}
      {!voucher ? (
        <div className="flex-1 flex items-center justify-center print:hidden">
          {loading ? (
            <div className="text-slate-400 text-sm">Loading voucher…</div>
          ) : unsupportedVoucher ? (
            <div className="max-w-md text-center px-6 py-8 bg-amber-50 border border-amber-200 rounded">
              <div className="text-sm font-semibold text-amber-900 mb-1">Not a printable voucher</div>
              <div className="text-[13px] text-amber-800">
                Tax-invoice format only supports <strong>Sales</strong> / <strong>Tax Invoice</strong> vouchers.
                <br />
                <span className="text-amber-700">
                  This voucher is "{unsupportedVoucher.vch_subtype_name && unsupportedVoucher.vch_subtype_name !== unsupportedVoucher.vch_type_name
                    ? unsupportedVoucher.vch_subtype_name
                    : (unsupportedVoucher.vch_type_name || unsupportedVoucher.vch_display_type || 'Unknown')}".
                </span>
              </div>
              <div className="text-[12px] text-amber-700 mt-2">Pick a Sales voucher from the search above.</div>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">Pick a Sales voucher from the search above to start.</div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 gap-3 p-3 overflow-hidden print:p-0 print:gap-0 print:block">
          {/* Editor panel intentionally removed — the invoice is read-only.
              Everything renders from the voucher + customer record; company
              details / bank / terms come from the saved defaults. */}
          {false && (
          <div className="no-print overflow-auto bg-white border border-slate-300 rounded p-3 space-y-4 print:hidden">
            <Section title="Company">
              <Input label="Name" value={company.name} onChange={v => setCompany(c => ({ ...c, name: v }))} />
              <TextArea label="Address" value={company.address} onChange={v => setCompany(c => ({ ...c, address: v }))} rows={2} />
              <Row>
                <Input label="Email" value={company.email} onChange={v => setCompany(c => ({ ...c, email: v }))} />
                <Input label="Phone" value={company.phone} onChange={v => setCompany(c => ({ ...c, phone: v }))} />
              </Row>
              <Row>
                <Input label="GSTIN" value={company.gstin} onChange={v => setCompany(c => ({ ...c, gstin: v }))} />
                <Input label="Logo URL" value={company.logo_url} onChange={v => setCompany(c => ({ ...c, logo_url: v }))} />
              </Row>
            </Section>

            <Section title="Invoice Details">
              <Row>
                <Input label="Invoice No." value={meta.invoice_no} onChange={v => setMeta(m => ({ ...m, invoice_no: v }))} />
                <Input label="Invoice Date" type="date" value={meta.invoice_date} onChange={v => setMeta(m => ({ ...m, invoice_date: v, due_date: m.due_date || addDays(v, 15) }))} />
              </Row>
              <Row>
                <Input label="Due Date" type="date" value={meta.due_date} onChange={v => setMeta(m => ({ ...m, due_date: v }))} />
                <Input label="Place of Supply" value={meta.place_of_supply} onChange={v => setMeta(m => ({ ...m, place_of_supply: v }))} />
              </Row>
              <Row>
                <label className="block flex-1">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Reverse Charge</span>
                  <select value={meta.reverse_charge} onChange={e => setMeta(m => ({ ...m, reverse_charge: e.target.value }))}
                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] bg-white">
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </label>
                <Input label="Payment Terms" value={meta.payment_terms} onChange={v => setMeta(m => ({ ...m, payment_terms: v }))} />
              </Row>
              <Input label="Remark" value={meta.remark} onChange={v => setMeta(m => ({ ...m, remark: v }))} />
            </Section>

            {/* Bill To — pre-filled from the customer record but every field
                is editable so the user can patch missing info or fix typos
                before printing without touching the customer master. */}
            <Section
              title="Bill To"
              right={
                <button
                  onClick={() => setBillTo({
                    name:     voucher?.party_name           || '',
                    address1: voucher?.party_address1       || '',
                    address2: voucher?.party_address2       || '',
                    city:     voucher?.party_city           || '',
                    state:    voucher?.party_state          || '',
                    pincode:  voucher?.party_pincode ? String(voucher.party_pincode) : '',
                    gstin:    voucher?.party_gst            || '',
                    phone:    voucher?.party_mobile ? String(voucher.party_mobile) : '',
                    email:    voucher?.party_email          || '',
                    contact:  voucher?.party_contact_person || '',
                  })}
                  className="text-[11px] text-blue-600 hover:text-blue-800 underline">
                  Reload from customer
                </button>
              }>
              <Input label="Name" value={billTo.name} onChange={v => setBillTo(b => ({ ...b, name: v }))} />
              <Input label="Address Line 1" value={billTo.address1} onChange={v => setBillTo(b => ({ ...b, address1: v }))} />
              <Input label="Address Line 2" value={billTo.address2} onChange={v => setBillTo(b => ({ ...b, address2: v }))} />
              <Row>
                <Input label="City" value={billTo.city} onChange={v => setBillTo(b => ({ ...b, city: v }))} />
                <Input label="State" value={billTo.state} onChange={v => setBillTo(b => ({ ...b, state: v }))} />
              </Row>
              <Row>
                <Input label="Pincode" value={billTo.pincode} onChange={v => setBillTo(b => ({ ...b, pincode: v }))} />
                <Input label="GSTIN" value={billTo.gstin} onChange={v => setBillTo(b => ({ ...b, gstin: v }))} />
              </Row>
              <Row>
                <Input label="Phone" value={billTo.phone} onChange={v => setBillTo(b => ({ ...b, phone: v }))} />
                <Input label="Email" value={billTo.email} onChange={v => setBillTo(b => ({ ...b, email: v }))} />
              </Row>
              <Input label="Contact Person" value={billTo.contact} onChange={v => setBillTo(b => ({ ...b, contact: v }))} />
            </Section>

            <Section title="Executive Details">
              <Row>
                <Input label="Executive Name" value={meta.executive_name} onChange={v => setMeta(m => ({ ...m, executive_name: v }))} />
                <Input label="Executive Phone" value={meta.executive_phone} onChange={v => setMeta(m => ({ ...m, executive_phone: v }))} />
              </Row>
            </Section>

            <Section
              title="Bank Account on Invoice"
              right={
                <button onClick={() => { setEditingBank(blankBank()); setBankEditorOpen(true); }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-blue-600 hover:text-blue-800">
                  <Plus size={11} /> Add Bank
                </button>
              }>
              <div className="space-y-1.5">
                {banks.map(b => (
                  <div key={b.id}
                    className={`p-2 border rounded cursor-pointer transition-colors ${activeBankId === b.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                    onClick={() => setActiveBankId(b.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Landmark size={12} className="text-slate-400 flex-shrink-0" />
                          <span className="font-medium text-slate-800 text-[13px] truncate">{b.account_name || '(unnamed)'}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums truncate">
                          {b.account_number} · {b.bank_name} {b.ifsc && `· ${b.ifsc}`}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); setEditingBank(b); setBankEditorOpen(true); }}
                          className="p-1 text-slate-400 hover:text-blue-600 rounded"><Pencil size={11} /></button>
                        {banks.length > 1 && (
                          <button onClick={(e) => { e.stopPropagation(); deleteBank(b.id); }}
                            className="p-1 text-slate-400 hover:text-red-600 rounded"><Trash2 size={11} /></button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title="Terms & Conditions"
              right={
                <button onClick={() => setTerms(t => [...t, ''])}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-blue-600 hover:text-blue-800">
                  <Plus size={11} /> Add
                </button>
              }>
              <div className="space-y-1.5">
                {terms.map((t, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="text-[11px] text-slate-400 mt-1.5 w-4 text-right">{i + 1}.</span>
                    <textarea value={t}
                      onChange={e => setTerms(prev => prev.map((x, idx) => idx === i ? e.target.value : x))}
                      rows={1}
                      className="flex-1 px-2 py-1 border border-slate-300 rounded text-[12px] outline-none focus:ring-1 focus:ring-blue-300 bg-white resize-none"
                      style={{ minHeight: '28px' }} />
                    <button onClick={() => setTerms(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-1 text-slate-400 hover:text-red-600 mt-0.5"><X size={12} /></button>
                  </div>
                ))}
                {terms.length === 0 && <div className="text-[11px] text-slate-400 italic">No terms — click Add to insert one.</div>}
              </div>
              <button onClick={() => { setTerms(DEFAULT_TERMS); showSuccess('Reset', 'Terms restored to default'); }}
                className="mt-2 text-[11px] text-slate-500 hover:text-slate-700 underline">
                Reset to default
              </button>
            </Section>
          </div>
          )}

          {/* ── Invoice preview (read-only) ── */}
          <div className="overflow-auto print:overflow-visible">
            <div ref={invoiceRef} className="max-w-[860px] mx-auto">
              <InvoicePreview
                company={company}
                voucher={voucher}
                meta={meta}
                billTo={billTo}
                items={lineItems}
                isIgst={isIgstInvoice}
                totals={totals}
                bank={activeBank}
                terms={terms}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bank editor modal */}
      {bankEditorOpen && editingBank && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex justify-between items-center px-5 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <Landmark size={15} className="text-blue-600" />
                {banks.some(b => b.id === editingBank.id) ? 'Edit Bank Account' : 'Add Bank Account'}
              </h3>
              <button onClick={() => { setBankEditorOpen(false); setEditingBank(null); }}
                className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <Input label="Account Name" value={editingBank.account_name} onChange={v => setEditingBank({ ...editingBank, account_name: v })} />
              <Input label="Account Number" value={editingBank.account_number} onChange={v => setEditingBank({ ...editingBank, account_number: v })} />
              <Row>
                <Input label="IFSC Code" value={editingBank.ifsc} onChange={v => setEditingBank({ ...editingBank, ifsc: v })} />
                <Input label="Bank Name" value={editingBank.bank_name} onChange={v => setEditingBank({ ...editingBank, bank_name: v })} />
              </Row>
              <Row>
                <Input label="Branch" value={editingBank.branch} onChange={v => setEditingBank({ ...editingBank, branch: v })} />
                <Input label="UPI ID" value={editingBank.upi_id} onChange={v => setEditingBank({ ...editingBank, upi_id: v })} />
              </Row>

              {/* UPI QR — accept any image (PNG/JPG/WebP); after upload the
                  cropper opens so the user can zoom + position + size the
                  output. The result is a base64 PNG saved with the bank
                  record so it survives reloads via localStorage. */}
              <div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">UPI QR Code</span>
                <div className="mt-1 flex items-start gap-3">
                  <div className="w-24 h-24 border border-dashed border-slate-300 rounded bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {editingBank.qr_image ? (
                      <img src={editingBank.qr_image} alt="QR" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-400 text-center px-1">No QR uploaded</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] border border-slate-300 rounded hover:bg-slate-50 bg-white text-slate-700 cursor-pointer">
                      <Plus size={12} /> {editingBank.qr_image ? 'Replace QR' : 'Upload QR'}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            setQrSourceUrl(String(reader.result || ''));
                            setQrCropperOpen(true);
                          };
                          reader.readAsDataURL(f);
                          e.currentTarget.value = ''; // allow re-uploading same file
                        }} />
                    </label>
                    {editingBank.qr_image && (
                      <button type="button"
                        onClick={() => { setQrSourceUrl(editingBank.qr_image || ''); setQrCropperOpen(true); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] border border-slate-300 rounded hover:bg-slate-50 bg-white text-slate-700 ml-1.5">
                        <Pencil size={11} /> Re-crop
                      </button>
                    )}
                    {editingBank.qr_image && (
                      <button type="button"
                        onClick={() => setEditingBank({ ...editingBank, qr_image: '' })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] border border-rose-200 rounded hover:bg-rose-50 bg-white text-rose-600 ml-1.5">
                        <X size={11} /> Remove
                      </button>
                    )}
                    <p className="text-[10px] text-slate-500 italic mt-1">Saved with the bank record — reused on every invoice print.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-slate-50">
              <button onClick={() => { setBankEditorOpen(false); setEditingBank(null); }}
                className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => saveBank(editingBank)}
                className="inline-flex items-center gap-1 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                <Save size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR cropper modal — opens after the user picks an image, lets them
          pan + zoom + size the output square, then writes the cropped
          PNG back into the bank record's qr_image field. */}
      {qrCropperOpen && qrSourceUrl && editingBank && (
        <QrCropperModal
          src={qrSourceUrl}
          onCancel={() => { setQrCropperOpen(false); setQrSourceUrl(''); }}
          onApply={(dataUrl) => {
            setEditingBank({ ...editingBank, qr_image: dataUrl });
            setQrCropperOpen(false);
            setQrSourceUrl('');
          }}
        />
      )}
    </div>
  );
}

// ─── Form helpers ───────────────────────────────────────────────────────

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">{title}</div>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}
function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
    </label>
  );
}
function TextArea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
        className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] outline-none focus:ring-1 focus:ring-blue-300 bg-white resize-y" />
    </label>
  );
}

// ─── Voucher picker dropdown ────────────────────────────────────────────

function PickerDropdown({
  loading, results, page, pageSize, onPickPage, onPick, onClose,
}: {
  loading: boolean; results: any[];
  page: number; pageSize: number; onPickPage: (n: number) => void;
  onPick: (v: any) => void; onClose: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const slice = results.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute top-full left-0 mt-1 w-[420px] max-h-[400px] bg-white border border-slate-300 rounded shadow-lg z-40 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="px-3 py-4 text-center text-slate-400 text-sm">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-4 text-center text-slate-400 text-sm">No vouchers match.</div>
          ) : (
            slice.map(v => (
              <button key={v.id}
                onClick={() => onPick(v)}
                className="w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-blue-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-800 text-[13px]">{v.vch_no || '—'}</span>
                  <span className="text-[11px] text-slate-500">{v.vch_date ? displayDate(v.vch_date) : ''}</span>
                </div>
                <div className="text-[12px] text-slate-600 truncate">{v.party_name || '—'}</div>
                <div className="text-[10px] text-slate-400">
                  {v.vch_subtype_name && v.vch_subtype_name !== v.vch_type_name
                    ? v.vch_subtype_name : v.vch_type_name}
                  {v.amount != null && <span className="ml-2 tabular-nums">₹ {fmt(v.amount)}</span>}
                </div>
              </button>
            ))
          )}
        </div>
        {results.length > pageSize && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-600">
            <span>{(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, results.length)} of {results.length}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => onPickPage(Math.max(1, safePage - 1))} disabled={safePage === 1}
                className="px-1.5 py-0.5 border border-slate-300 rounded bg-white disabled:opacity-30">‹</button>
              <span>{safePage} / {totalPages}</span>
              <button onClick={() => onPickPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}
                className="px-1.5 py-0.5 border border-slate-300 rounded bg-white disabled:opacity-30">›</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Invoice preview ────────────────────────────────────────────────────

function InvoicePreview({
  company, voucher, meta, billTo, items, isIgst, totals, bank, terms,
}: {
  company: CompanyInfo;
  voucher: any;
  meta: any;
  billTo: {
    name: string; address1: string; address2: string; city: string; state: string;
    pincode: string; gstin: string; phone: string; email: string; contact: string;
  };
  items: any[];
  isIgst: boolean;
  totals: { taxable: number; cgst: number; sgst: number; igst: number; extras?: { name: string; amount: number }[]; total: number };
  bank: BankAccount;
  terms: string[];
}) {
  const payAmount = totals.total || Math.abs(Number(voucher?.amount || 0));
  const upiQr = useUpiQr(payAmount, meta.invoice_no || voucher?.vch_no || '', bank.upi_id || '', bank.account_name || company.name);
  // Bill-to lines come from the editable billTo state (pre-filled from
  // the customer record). Each line renders only when populated so we
  // don't get blank rows on the printed invoice.
  const cityStatePin = [billTo.city, billTo.state, billTo.pincode].filter(Boolean).join(', ');
  const billToLines = [
    billTo.address1,
    billTo.address2,
    cityStatePin,
  ].filter(Boolean);

  return (
    <div className="invoice-page bg-white text-slate-900 mx-auto" style={{ maxWidth: '820px' }}>
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          .invoice-page { box-shadow: none !important; max-width: 100% !important; min-height: 0 !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          a, a:visited { color: inherit !important; text-decoration: none !important; }
          nav, header { display: none !important; }
          .no-print { display: none !important; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:overflow-visible { overflow: visible !important; }
          .print\\:static { position: static !important; }
          .print\\:h-auto { height: auto !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:gap-0 { gap: 0 !important; }
          .print\\:bg-white { background-color: #ffffff !important; }
          .print\\:border-0 { border: none !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          td, th { color: inherit !important; }
          .bg-emerald-800 { background-color: #065f46 !important; color: #ffffff !important; }
          .text-emerald-800 { color: #065f46 !important; }
          .bg-emerald-50 { background-color: #ecfdf5 !important; }
          .text-emerald-700 { color: #047857 !important; }
          .border-slate-200 { border-color: #e2e8f0 !important; }
          .border-emerald-900 { border-color: #064e3b !important; }
          .text-slate-600 { color: #475569 !important; }
          .text-slate-400 { color: #94a3b8 !important; }
          .text-slate-700 { color: #334155 !important; }
          .text-slate-900 { color: #0f172a !important; }
          .text-slate-800 { color: #1e293b !important; }
          .text-slate-500 { color: #64748b !important; }
          .font-medium { font-weight: 500 !important; }
          .font-semibold { font-weight: 600 !important; }
          .font-bold { font-weight: 700 !important; }
        }
      `}</style>

      <div className="shadow-sm border border-slate-200 print:border-0 print:shadow-none px-4 py-8 print:p-0">
        {/* Header */}
        <div className="flex items-start gap-4 pb-4 border-b border-slate-200">
          {company.logo_url && (
            <img src={company.logo_url} alt={company.name}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="w-20 h-20 object-contain flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-2xl font-bold text-emerald-800">{company.name}</div>
            <div className="text-[12px] text-slate-700 whitespace-pre-line">{company.address}</div>
            <div className="text-[12px] text-slate-700 mt-1">
              ✉ {company.email}  &nbsp;·&nbsp;  ☎ {company.phone}
            </div>
            <div className="text-[12px] font-semibold text-slate-800 mt-0.5">GSTIN: {company.gstin}</div>
          </div>
          {/* QR + UPI in header top-right */}
          {upiQr && (
            <div className="flex-shrink-0 text-right flex flex-col items-end gap-1">
              <img src={upiQr} alt="UPI QR"
                className="w-24 h-24 object-contain border border-slate-200 rounded bg-white" />
              <div className="text-[10px] text-slate-500">UPI: <span className="font-medium text-slate-700">{bank.upi_id}</span></div>
            </div>
          )}
        </div>

        {/* Title */}
        <div className="text-center py-4">
          <div className="text-2xl font-bold text-emerald-800 tracking-wide">TAX INVOICE</div>
        </div>

        {/* Invoice + Bill To — one box with vertical divider */}
        <div className="border border-slate-200 rounded bg-slate-50/50 mb-3 flex">
          <div className="flex-1 p-3">
            <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Invoice Details</div>
            <KV label="Invoice No."     value={meta.invoice_no || '—'} />
            <KV label="Invoice Date"    value={displayDate(meta.invoice_date)} />
            <KV label="Due Date"        value={displayDate(meta.due_date)} />
            <KV label="Place of Supply" value={meta.place_of_supply} />
            <KV label="Reverse Charge"  value={meta.reverse_charge} />
            <KV label="Payment Terms"   value={meta.payment_terms} />
          </div>
          <div className="w-px bg-slate-200 my-2" />
          <div className="flex-1 p-3">
            <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Bill To</div>
            <div className="font-semibold text-[14px] text-slate-900">{billTo.name || voucher.party_name || '—'}</div>
            {billToLines.map((l, i) => (
              <div key={i} className="text-[12px] text-slate-700">{l}</div>
            ))}
            <div className="mt-1.5 space-y-0.5">
              {billTo.gstin   && <KV label="GSTIN"          value={billTo.gstin} />}
              {billTo.contact && <KV label="Contact Person" value={billTo.contact} />}
              {billTo.phone   && <KV label="Phone"          value={billTo.phone} />}
              {billTo.email   && <KV label="Email"          value={billTo.email} />}
            </div>
          </div>
        </div>

        {/* Executive details (single row) */}
        {(meta.executive_name || meta.executive_phone) && (
          <div className="border border-slate-200 rounded p-2.5 mb-3 bg-slate-50/50 flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px]">
            <span className="text-[11px] font-bold text-slate-700 uppercase">Executive</span>
            {meta.executive_name  && <span><span className="text-slate-500">Name:</span> <strong>{meta.executive_name}</strong></span>}
            {meta.executive_phone && <span><span className="text-slate-500">Phone:</span> <strong>{meta.executive_phone}</strong></span>}
            <span><span className="text-slate-500">Payment Terms:</span> <strong>{meta.payment_terms}</strong></span>
          </div>
        )}

        {/* Items table */}
        <table className="w-full border-collapse text-[12px] mb-3">
          <thead>
            <tr className="bg-emerald-800 text-white">
              <th className="border border-emerald-900 px-2 py-2 text-center w-10">#</th>
              <th className="border border-emerald-900 px-2 py-2 text-center">Description</th>
              <th className="border border-emerald-900 px-2 py-2 text-center w-20">SAC</th>
              <th className="border border-emerald-900 px-2 py-2 text-center w-20">GST Rate</th>
              <th className="border border-emerald-900 px-2 py-2 text-center w-14">Qty</th>
              <th className="border border-emerald-900 px-2 py-2 text-center w-24">Rate (₹)</th>
              <th className="border border-emerald-900 px-2 py-2 text-center w-28">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="border border-slate-200 px-2 py-4 text-center text-slate-400">
                  This voucher has no inventory items — only journal/ledger entries. Pick an items-mode voucher (Sales / Purchase) for a tax invoice.
                </td>
              </tr>
            ) : items.map((it, i) => (
              <tr key={i}>
                <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{i + 1}</td>
                <td className="border border-slate-200 px-2 py-1.5">{it.description}</td>
                <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{it.sac || '—'}</td>
                <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{it.gst_rate}%</td>
                <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(it.rate)}</td>
                <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(it.amount)}</td>
              </tr>
            ))}
            {items.length > 0 && (
              <>
                <tr>
                  <td className="border border-slate-200 px-2 py-1.5"></td>
                  <td colSpan={5} className="border border-slate-200 px-2 py-1.5 text-right font-semibold">Total Taxable Amount</td>
                  <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(totals.taxable)}</td>
                </tr>
                {!isIgst && totals.cgst > 0 && (
                  <tr>
                    <td className="border border-slate-200 px-2 py-1.5"></td>
                    <td colSpan={3} className="border border-slate-200 px-2 py-1.5"></td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right">CGST</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">—</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(totals.cgst)}</td>
                  </tr>
                )}
                {!isIgst && totals.sgst > 0 && (
                  <tr>
                    <td className="border border-slate-200 px-2 py-1.5"></td>
                    <td colSpan={3} className="border border-slate-200 px-2 py-1.5"></td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right">SGST</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">—</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(totals.sgst)}</td>
                  </tr>
                )}
                {isIgst && totals.igst > 0 && (
                  <tr>
                    <td className="border border-slate-200 px-2 py-1.5"></td>
                    <td colSpan={3} className="border border-slate-200 px-2 py-1.5"></td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right">IGST</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">—</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(totals.igst)}</td>
                  </tr>
                )}
                <tr>
                  <td className="border border-slate-200 px-2 py-1.5"></td>
                  <td colSpan={5} className="border border-slate-200 px-2 py-1.5 text-right font-semibold">Total GST Amount</td>
                  <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(totals.cgst + totals.sgst + totals.igst)}</td>
                </tr>
                {(totals.extras || []).map((ex, i) => (
                  <tr key={`extra-${i}`}>
                    <td className="border border-slate-200 px-2 py-1.5"></td>
                    <td colSpan={5} className="border border-slate-200 px-2 py-1.5 text-right">{ex.name}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{ex.amount < 0 ? `(${fmt(Math.abs(ex.amount))})` : fmt(ex.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50">
                  <td className="border border-slate-200 px-2 py-2"></td>
                  <td colSpan={5} className="border border-slate-200 px-2 py-2 text-right font-bold text-emerald-800 uppercase tracking-wide">Total Amount Payable</td>
                  <td className="border border-slate-200 px-2 py-2 text-right tabular-nums font-bold text-emerald-800">{fmt(totals.total)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>


        {/* Amount in Words + Bank Details — single bordered row */}
        <div className="border border-slate-200 rounded mb-3 mt-3 flex items-stretch text-[11px]">
          {/* Left: Amount in Words */}
          <div className="flex-1 px-3 py-2 border-r border-slate-200">
            <span className="font-bold text-slate-700 uppercase">Amount in Words: </span>
            <span className="text-slate-800 font-medium">{numberToWords(payAmount || totals.total)}</span>
          </div>
          {/* Right: Bank details in 2×2 grid */}
          <div className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-0.5 content-center">
            <div><span className="text-slate-500">Account Number</span> : <span className="font-medium">{bank.account_number}</span></div>
            <div><span className="text-slate-500">Account Name</span> : <span className="font-medium">{bank.account_name}</span></div>
            <div><span className="text-slate-500">Bank Name</span> : <span className="font-medium">{bank.bank_name}</span></div>
            <div><span className="text-slate-500">IFSC Code</span> : <span className="font-medium">{bank.ifsc}</span></div>
          </div>
        </div>

        {/* Remark — ALWAYS shown (required checklist field); sits under the
            Amount-in-Words / bank block and above Terms. Filled from the
            voucher's saved remark, or type one in the editor's Remark field. */}
        <div className="border border-slate-200 rounded mb-3 px-3 py-2 text-[11px]">
          <span className="font-bold text-slate-700 uppercase">Remark: </span>
          <span className="text-slate-800 font-medium">{meta.remark || '—'}</span>
        </div>

        {/* Footer: terms | sign */}
        <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-200">
          <div className="col-span-2">
            <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Terms & Conditions</div>
            <ol className="text-[11px] text-slate-700 space-y-1">
              {terms.map((t, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-slate-400 tabular-nums">{i + 1}.</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="text-center">
            <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">For {company.name}</div>
            <div className="h-20"></div>
            <div className="border-t border-slate-400 mx-auto pt-1 text-[11px] text-slate-700" style={{ maxWidth: '200px' }}>
              Authorised Signatory
            </div>
          </div>
        </div>

        <div className="text-center pt-3 mt-3 border-t border-slate-200">
          <div className="text-[11px] text-slate-600">Subject to Guwahati Jurisdiction.</div>
          <div className="text-[11px] text-slate-600">This is a computer generated invoice and does not require physical signature.</div>
          <div className="text-[11px] text-emerald-700 font-medium mt-1">♥ Thank you for your business!</div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex text-[12px] py-0.5">
      <div className="w-32 text-slate-600">{label}</div>
      <div className="text-slate-400 mx-1">:</div>
      <div className="flex-1 text-slate-900">{value || '—'}</div>
    </div>
  );
}

// ─── QR Cropper ─────────────────────────────────────────────────────────
//
// Lightweight cropper that doesn't pull in a third-party lib. The user's
// image is loaded into an offscreen <img>, drawn into a canvas, and then
// transformed by a zoom + offset (pan) + crop-window combo. The crop
// window is fixed at 240×240 in the UI; the user pans/zooms the image
// underneath. Apply re-renders the visible window into a smaller output
// canvas and returns its PNG data-URL.
//
// Why this approach: most UPI QR captures are screenshots that include
// extra padding / app chrome. Pan-and-zoom inside a fixed window is the
// shortest path to a usable square QR, and avoids the complexity of
// per-corner drag handles + aspect-ratio enforcement.

const CROP_WINDOW = 240;       // fixed crop viewport (px)
const QR_OUTPUT   = 360;       // output PNG dimensions (px) — 2× density

function QrCropperModal({
  src, onCancel, onApply,
}: {
  src: string;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSize, setImgSize]   = useState({ w: 0, h: 0 });
  const [zoom, setZoom]         = useState(1);
  const [offset, setOffset]     = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Load source image to read its natural dimensions; default zoom fits
  // the smaller of width/height into the crop window, then user can zoom
  // in further if they want a tighter crop.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      const fitZoom = Math.max(CROP_WINDOW / img.naturalWidth, CROP_WINDOW / img.naturalHeight);
      setZoom(fitZoom);
      // Center the image in the crop window.
      setOffset({
        x: (CROP_WINDOW - img.naturalWidth * fitZoom) / 2,
        y: (CROP_WINDOW - img.naturalHeight * fitZoom) / 2,
      });
    };
    img.src = src;
  }, [src]);

  const onMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({ x: dragStartRef.current.ox + dx, y: dragStartRef.current.oy + dy });
  };
  const onMouseUp = () => { setDragging(false); dragStartRef.current = null; };

  // Convert the on-screen window (CROP_WINDOW px) back into source-image
  // coordinates: undo the offset + zoom to get the rect that's currently
  // visible. Then redraw it scaled to QR_OUTPUT.
  const apply = () => {
    if (!imgRef.current) return;
    const sx = (-offset.x) / zoom;
    const sy = (-offset.y) / zoom;
    const sw = CROP_WINDOW / zoom;
    const sh = CROP_WINDOW / zoom;
    const canvas = document.createElement('canvas');
    canvas.width = QR_OUTPUT;
    canvas.height = QR_OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, QR_OUTPUT, QR_OUTPUT);
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, QR_OUTPUT, QR_OUTPUT);
    onApply(canvas.toDataURL('image/png'));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 print:hidden"
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Crop UPI QR</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          {/* Crop viewport. Image is rendered with translate + scale; the
              square at the centre is the implicit crop window. */}
          <div
            className="relative mx-auto bg-slate-100 border border-slate-300 overflow-hidden cursor-grab active:cursor-grabbing select-none"
            style={{ width: CROP_WINDOW, height: CROP_WINDOW }}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove}>
            {imgSize.w > 0 && (
              <img src={src} alt="QR source"
                draggable={false}
                style={{
                  width: imgSize.w, height: imgSize.h,
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  pointerEvents: 'none',
                  imageRendering: 'auto',
                }} />
            )}
            {/* Frame overlay so the user knows what's being captured */}
            <div className="absolute inset-0 ring-2 ring-blue-500/70 pointer-events-none" />
          </div>

          <div className="mt-4 space-y-1">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Zoom</span>
              <input type="range" min={0.05} max={4} step={0.01} value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="w-full" />
            </label>
            <p className="text-[11px] text-slate-500">Drag the image to position. Slider zooms in/out.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-slate-50">
          <button onClick={onCancel}
            className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={apply}
            className="inline-flex items-center gap-1 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            <Save size={14} /> Apply
          </button>
        </div>
      </div>
    </div>
  );
}
