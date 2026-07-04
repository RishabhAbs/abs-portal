import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X, Save, UserPlus, Eye, EyeOff, ChevronDown, ArrowLeft, Trash2, Printer, Download } from 'lucide-react';
import { itemsApi, customersApi, vouchersApi, otherLedgerApi, vchTypeApi, activitiesApi, leadRequirementsApi, ledgerGroupApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';

const MY_STATE = 'Assam';

const COMPANY_KEY = 'print-voucher-company';
const BANKS_KEY   = 'print-voucher-banks';
const TERMS_KEY   = 'print-voucher-terms';
const ACTIVE_BANK_KEY = 'print-voucher-active-bank';

const DEFAULT_COMPANY = {
  name:    'ABS Technologies',
  address: '1st Floor, Ram Kumar Plaza, A.T. Road,\nChatribari, Guwahati, Assam, 781001',
  email:   'accounts@abstechnologies.co.in',
  phone:   '9706050760',
  gstin:   '18ACMFA5628G1Z7',
  logo_url: '/logo.png',
};
const DEFAULT_BANK = {
  id: 'default',
  account_name:   'ABS Technologies',
  account_number: '50200117974614',
  ifsc:           'HDFC0004707',
  bank_name:      'HDFC Bank',
  branch:         'Paltan Bazar',
  upi_id:         'abstechnologies@hdfcbank',
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
function loadList<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch { /* ignore */ }
  return fallback;
}

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
  return d.toISOString().split('T')[0];
};

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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex text-[12px] py-0.5">
      <div className="w-32 text-slate-600">{label}</div>
      <div className="text-slate-400 mx-1">:</div>
      <div className="flex-1 text-slate-900">{value || '—'}</div>
    </div>
  );
}

interface BatchRow {
  id: string;
  batch_name: string;
  qty: number;
  rate: number;
  amount: number;
  serialSearch?: string;
  serialOpen?: boolean;
}

interface LineItem {
  product_id: string;
  item_name: string;
  // Custom-dropdown state — replaces the native <select> so the picker
  // always opens DOWNWARD instead of letting the browser flip it upward
  // when the row is near the bottom of the viewport.
  item_search?: string;
  item_open?: boolean;
  qty: number;
  rate: number;
  amount: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
  batch_rows?: BatchRow[];
}

interface LedgerRow {
  id: string;           // local key
  ledger_id: number | null;
  ledger_name: string;
  amount: number;
  auto: boolean;        // true = CGST/SGST/IGST auto rows
  search: string;
  open: boolean;
}

interface JournalRow {
  id: string;
  drOrCr: 'Dr' | 'Cr';
  ledger_id: number | null;
  ledger_name: string;
  dr_amount: number;
  cr_amount: number;
  search: string;
  open: boolean;
  results: any[];
  billByBill: boolean;
  billAlloc: { id: string; type: 'New' | 'Agr.' | 'On Account'; refno: string; amount: number; direction?: string; refSearch?: string; refOpen?: boolean }[];
}

const emptyJournalRow = (): JournalRow => ({
  id: uid(), drOrCr: 'Dr', ledger_id: null, ledger_name: '',
  dr_amount: 0, cr_amount: 0, search: '', open: false, results: [],
  billByBill: false, billAlloc: [],
});

const emptyLine = (): LineItem => ({
  product_id: '', item_name: '', qty: 1, rate: 0,
  amount: 0, gst_rate: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, line_total: 0,
});

const applyGst = (item: LineItem, amount: number, isIgst: boolean): LineItem => {
  let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
  if (isIgst) {
    igst_amount = +(amount * item.gst_rate / 100).toFixed(2);
  } else {
    cgst_amount = +(amount * (item.gst_rate / 2) / 100).toFixed(2);
    sgst_amount = +(amount * (item.gst_rate / 2) / 100).toFixed(2);
  }
  const line_total = +(amount + cgst_amount + sgst_amount + igst_amount).toFixed(2);
  return { ...item, amount, cgst_amount, sgst_amount, igst_amount, line_total };
};

const calcLine = (item: LineItem, isIgst: boolean): LineItem => {
  const amount = +(item.qty * item.rate).toFixed(2);
  return applyGst(item, amount, isIgst);
};

// When amount is edited directly: back-calculate rate = amount / qty
const calcLineFromAmount = (item: LineItem, isIgst: boolean, newAmount: number): LineItem => {
  const rate = item.qty > 0 ? +(newAmount / item.qty).toFixed(4) : item.rate;
  return applyGst({ ...item, rate }, newAmount, isIgst);
};

const uid = () => Math.random().toString(36).slice(2);

interface VchTypeItem {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  is_system: number;
}

interface StockLine { id: string; item_id: string | null; item_name: string; search: string; open: boolean; qty: number; rate: number; amount: number; gst_rate: number; batch_yes: boolean; batch_rows: { id: string; batch_name: string; qty: number; rate: number; amount: number }[]; results?: any[] }
const emptyStockLine = (): StockLine => ({ id: uid(), item_id: null, item_name: '', search: '', open: false, qty: 0, rate: 0, amount: 0, gst_rate: 0, batch_yes: false, batch_rows: [] });
const emptyBatchRow = () => ({ id: uid(), batch_name: '', qty: 0, rate: 0, amount: 0 });
const fmt = (n: number) => n.toFixed(2);

// Batch popup — opened when clicking the batch button on a stock line
interface StockBatchPopupProps {
  line: StockLine;
  onSave: (rows: StockLine['batch_rows']) => void;
  onClose: () => void;
}
const StockBatchPopup: React.FC<StockBatchPopupProps> = ({ line, onSave, onClose }) => {
  const [rows, setRows] = React.useState<StockLine['batch_rows']>(
    line.batch_rows.length ? line.batch_rows : [emptyBatchRow()]
  );
  const totQty = rows.reduce((s, b) => s + b.qty, 0);
  const totAmt = rows.reduce((s, b) => s + b.amount, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-2 border-b border-gray-100">
          <div>
            <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">Batch / Serial Entry</p>
            <p className="text-base font-bold text-gray-800 mt-0.5">{line.item_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5"><X size={18} /></button>
        </div>
        {/* Table */}
        <div className="overflow-y-auto flex-1 px-4 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-500 uppercase border-b border-gray-200">
                <th className="pb-1.5 text-left w-6">#</th>
                <th className="pb-1.5 text-left">Serial / Batch No.</th>
                <th className="pb-1.5 text-right w-20">Qty</th>
                <th className="pb-1.5 text-right w-20">Rate</th>
                <th className="pb-1.5 text-right w-24">Amount</th>
                <th className="pb-1.5 w-5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((br, idx) => (
                <tr key={br.id} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-400 text-xs pr-1">{idx + 1}</td>
                  <td className="py-1.5 pr-1">
                    <input autoFocus={idx === 0} type="text" value={br.batch_name} placeholder="Enter serial no."
                      onChange={e => setRows(p => p.map(b => b.id === br.id ? { ...b, batch_name: e.target.value } : b))}
                      className="w-full border border-gray-200 rounded py-1 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </td>
                  <td className="py-1.5 pr-1">
                    <input type="number" step="any" value={br.qty || ''} placeholder=""
                      onChange={e => {
                        const qty = parseFloat(e.target.value) || 0;
                        setRows(p => p.map(b => b.id === br.id ? { ...b, qty, amount: +(qty * b.rate).toFixed(2) } : b));
                      }}
                      className="w-full border border-gray-200 rounded py-1 px-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </td>
                  <td className="py-1.5 pr-1">
                    <input type="number" step="any" value={br.rate || ''} placeholder=""
                      onChange={e => {
                        const rate = parseFloat(e.target.value) || 0;
                        setRows(p => p.map(b => b.id === br.id ? { ...b, rate, amount: +(b.qty * rate).toFixed(2) } : b));
                      }}
                      className="w-full border border-gray-200 rounded py-1 px-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </td>
                  <td className="py-1.5 pr-1">
                    <input type="number" step="any" value={br.amount || ''} placeholder=""
                      onChange={e => setRows(p => p.map(b => b.id === br.id ? { ...b, amount: parseFloat(e.target.value) || 0 } : b))}
                      className="w-full border border-gray-200 rounded py-1 px-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium" />
                  </td>
                  <td className="py-1.5 text-center">
                    {rows.length > 1 && (
                      <button onClick={() => setRows(p => p.filter(b => b.id !== br.id))} className="text-red-400 hover:text-red-600"><X size={13} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setRows(p => [...p, emptyBatchRow()])}
            className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 mt-2">
            <Plus size={12} /> Add Serial No.
          </button>
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <div className="text-sm text-gray-600 flex gap-4">
            <span>Total Qty: <strong>{totQty.toFixed(3)}</strong></span>
            <span>Total Amt: <strong>₹{totAmt.toFixed(2)}</strong></span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
            <button onClick={() => onSave(rows)} className="px-5 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const StockSide: React.FC<{ title: string; lines: StockLine[]; setLines: React.Dispatch<React.SetStateAction<StockLine[]>>; onOpenBatch: (lineId: string) => void }> = ({ title, lines, setLines, onOpenBatch }) => (
  <div className="flex-1 min-w-0">
    <div className="text-center text-[11px] font-bold uppercase tracking-wide bg-gray-100 border-b border-gray-300 py-1.5 text-gray-600">{title}</div>
    <table className="w-full text-sm">
      <thead className="bg-gray-50">
        <tr className="text-[11px] text-gray-500 uppercase">
          <th className="py-1.5 px-2 text-left w-7">#</th>
          <th className="py-1.5 px-2 text-left">Name of Item</th>
          <th className="py-1.5 px-2 text-right w-20">Quantity</th>
          <th className="py-1.5 px-2 text-right w-20">Rate</th>
          <th className="py-1.5 px-2 text-right w-24">Amount</th>
          <th className="py-1.5 px-2 w-6"></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, idx) => (
          <tr key={line.id} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="py-1 px-2 text-gray-400 text-xs">{idx + 1}</td>
            <td className="py-1 px-1">
              <div className="relative">
                <input type="text" value={line.search}
                  onChange={e => {
                    const q = e.target.value;
                    setLines(p => p.map(l => l.id === line.id ? { ...l, search: q, item_id: null, item_name: '', open: q.length >= 1, batch_yes: false, batch_rows: [] } : l));
                    if (q.length >= 1) {
                      itemsApi.getAll().then((res: any) => {
                        const all = res?.data || res || [];
                        const list = all.filter((it: any) => (it.item_name || '').toLowerCase().includes(q.toLowerCase()));
                        setLines(p => p.map(l => l.id === line.id ? { ...l, results: list, open: true } : l));
                      }).catch(() => {});
                    }
                  }}
                  onBlur={() => setTimeout(() => setLines(p => p.map(l => l.id === line.id ? { ...l, open: false } : l)), 200)}
                  placeholder="Search item..."
                  className={`w-full border rounded text-sm py-1 px-2 focus:outline-none focus:ring-1 ${line.item_id ? 'border-green-400 bg-green-50' : 'border-gray-200 focus:ring-blue-400'}`}
                />
                {line.open && (line.results || []).length > 0 && (
                  <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                    {(line.results || []).slice(0, 20).map((it: any) => (
                      <div key={it.id} onPointerDown={() => {
                        const batchYes = it.batch === 'Yes';
                        setLines(p => p.map(l => l.id === line.id ? {
                          ...l, item_id: String(it.id), item_name: it.item_name, search: it.item_name, open: false,
                          batch_yes: batchYes, batch_rows: batchYes ? [emptyBatchRow()] : [],
                        } : l));
                        if (batchYes) setTimeout(() => onOpenBatch(line.id), 50);
                      }} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50 flex items-center justify-between">
                        <span>{it.item_name}</span>
                        {it.batch === 'Yes' && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Batch</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </td>
            <td className="py-1 px-1">
              {line.batch_yes ? (
                <button onClick={() => onOpenBatch(line.id)}
                  className={`w-full border rounded text-sm py-1 px-1 text-right ${line.batch_rows.length > 0 && line.qty > 0 ? 'border-green-400 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-600'}`}>
                  {line.qty > 0 ? line.qty : 'Set →'}
                </button>
              ) : (
                <input type="number" step="any" value={line.qty || ''} placeholder="0"
                  onChange={e => { const qty = parseFloat(e.target.value) || 0; setLines(p => p.map(l => l.id === line.id ? { ...l, qty, amount: +(qty * l.rate).toFixed(2) } : l)); }}
                  className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
              )}
            </td>
            <td className="py-1 px-1">
              <input type="number" step="any" value={line.rate || ''} placeholder="0.00"
                onChange={e => { const rate = parseFloat(e.target.value) || 0; setLines(p => p.map(l => l.id === line.id ? { ...l, rate, amount: +(l.qty * rate).toFixed(2) } : l)); }}
                disabled={line.batch_yes}
                className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-400" />
            </td>
            <td className="py-1 px-1">
              {line.batch_yes ? (
                <button onClick={() => onOpenBatch(line.id)}
                  className={`w-full border rounded text-sm py-1 px-1 text-right font-medium ${line.batch_rows.length > 0 && line.amount > 0 ? 'border-green-400 bg-green-50 text-green-700' : 'border-orange-300 bg-orange-50 text-orange-600'}`}>
                  {line.amount > 0 ? fmt(line.amount) : 'Set →'}
                </button>
              ) : (
                <input type="number" step="any" value={line.amount || ''} placeholder="0.00"
                  onChange={e => setLines(p => p.map(l => l.id === line.id ? { ...l, amount: parseFloat(e.target.value) || 0 } : l))}
                  className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium" />
              )}
            </td>
            <td className="py-1 px-1 text-center">
              {lines.length > 1 && (
                <button onClick={() => setLines(p => p.filter(l => l.id !== line.id))} className="text-red-400 hover:text-red-600"><X size={14} /></button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-gray-100">
          <td colSpan={6} className="py-1 px-2">
            <button onClick={() => setLines(p => [...p, emptyStockLine()])}
              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800">
              <Plus size={12} /> Add Item
            </button>
          </td>
        </tr>
        <tr className="border-t-2 border-gray-200 bg-gray-50">
          <td colSpan={4} className="py-1.5 px-2 text-xs font-semibold text-gray-500 uppercase">Total</td>
          <td className="py-1.5 px-1 text-right text-sm font-bold text-blue-600">
            {fmt(lines.reduce((s, l) => s + (l.amount || 0), 0))}
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  </div>
);

const Vouchers: React.FC = () => {
  const { user, isAdmin, canCheckPermission, canDelete, canEdit } = useAuth();
  const { showSuccess, showError } = useToast();

  const handleDirectDownload = (id: number | string) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;';
    iframe.src = `/billing/print-voucher/${id}?download=1`;
    document.body.appendChild(iframe);
    setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 30000);
  };

  // --- Print States ---
  const [printCompany] = useState(() => loadJson(COMPANY_KEY, DEFAULT_COMPANY));
  const [printBanks]     = useState(() => loadList(BANKS_KEY, [DEFAULT_BANK]));
  const [printActiveBankId] = useState(() => localStorage.getItem(ACTIVE_BANK_KEY) || 'default');
  const [printTerms]     = useState(() => loadList(TERMS_KEY, DEFAULT_TERMS));
  const [printBillTo, setPrintBillTo]   = useState({
    name: '', address1: '', address2: '', city: '', state: '',
    pincode: '', gstin: '', phone: '', email: '', contact: ''
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 'mark' = confirm marking as Checked, 'unmark' = confirm removing the flag.
  // Null when no confirmation is pending. Saving is handled inline in the
  // modal's confirm button — keeping a single state prevents two modals
  // ever being open at once.
  const [checkConfirm, setCheckConfirm] = useState<null | 'mark' | 'unmark'>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ── Lead → Voucher linkage ──
  // When this page is opened from LeadReport.tsx via /billing/vouchers/new?lead_id=X,
  // prefill the customer/remark from the lead and pass lead_id on save. Backend
  // auto-closes the lead with closed_via='Billing' after the voucher inserts.
  const leadIdFromUrl = searchParams.get('lead_id');
  const [linkedLeadId, setLinkedLeadId] = useState<number | null>(
    leadIdFromUrl ? parseInt(leadIdFromUrl, 10) || null : null
  );
  const [linkedLeadInfo, setLinkedLeadInfo] = useState<{ customer_name?: string; mobile_no?: string; lead_type?: string } | null>(null);

  // Read-only mode is set when navigated here from Ledger Report (or any
  // other report) by a user without activities.edit permission, OR when
  // the loaded voucher is marked as Checked and the current user isn't
  // admin. Both feed the same `readOnly` flag.
  const navReadOnly = !!(location.state as any)?.readOnly;
  const [checkedBy, setCheckedBy]   = useState<string | null>(null);
  const [checkedAt, setCheckedAt]   = useState<string | null>(null);
  const isAdminUser = isAdmin();
  const checkedLockActive = !!checkedBy && !isAdminUser;
  const readOnly = navReadOnly || checkedLockActive;

  // Anyone with edit access to vouchers (or activities) can mark a voucher
  // as Checked — that's the routine reviewer flow. Unmarking is locked down
  // to admins because it removes an audit trail entry.
  const canMarkAsChecked =
    canCheckPermission('vouchers', 'check')
    || canEdit('vouchers')
    || canEdit('activities');
  const canUnmarkAsChecked = isAdminUser;

  // Vch types
  const [allVchTypes, setAllVchTypes]       = useState<VchTypeItem[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);

  const [editId, setEditId] = useState<number | null>(null);
  // Mirrors editId synchronously (refs update immediately, unlike state) so
  // an async getNextNo response can check "are we still on this voucher?"
  // before applying — otherwise a slow response from a previously-open
  // voucher could land on whatever voucher is open now.
  const editIdRef = useRef<number | null>(null);
  const [voucherNo, setVoucherNo]     = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));

  // Party
  const [partyId, setPartyId]               = useState('');
  const [partyDisplay, setPartyDisplay]     = useState('');
  const [partyState, setPartyState]         = useState('');
  const [isIgst, setIsIgst]               = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDrop, setShowCustomerDrop] = useState(false);
  const [customers, setCustomers]           = useState<any[]>([]);
  const customerRef                         = useRef<HTMLDivElement>(null);
  // Refs used to TRAP focus on ledger / customer fields that have free-typed
  // text but no selection. setTimeout-driven so dropdown clicks (which fire
  // before blur) get a chance to set the id first.
  const customerInputRef                     = useRef<HTMLInputElement>(null);
  const journalInputRefs                     = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const ledgerInputRefs                      = useRef<Map<string, HTMLInputElement | null>>(new Map());
  // Refs for popups so we can auto-focus their first input when they open.
  const batchPopupRef                        = useRef<HTMLDivElement>(null);
  const newCustomerPopupRef                  = useRef<HTMLDivElement>(null);
  const billAllocPopupRef                    = useRef<HTMLDivElement>(null);
  const cloudPopupRef                        = useRef<HTMLDivElement>(null);

  // ── Cloud-category billing-activity picker ──
  // When an item with category "Cloud" is selected for a voucher line, we
  // open a popup listing the customer's pending cloud_activities (those
  // with no voucher_no yet). User multi-selects → amounts sum into the
  // line. After voucher save, the selected activities are stamped with
  // the voucher's vch_no via activitiesApi.markBilled.
  const CLOUD_CATEGORY_ID = 3;
  const [cloudPopup, setCloudPopup] = useState<{
    lineIdx: number;
    activities: any[];
    selectedIds: Set<string>;
    loading: boolean;
    isCreditNote?: boolean;
  } | null>(null);
  const [activitiesToLink, setActivitiesToLink] = useState<string[]>([]);

  // Inline customer creation
  const SUNDRY_DEBTORS_ID = 26; // ledgergroup id for parties (Sundry Debtors)
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const blankCustForm = () => ({ company: '', mobile: '', gstin: '', email: '', pincode: '', address1: '', address2: '', area: '', state: '', ledgergroup: SUNDRY_DEBTORS_ID });
  const [custForm, setCustForm] = useState(blankCustForm());
  const [ledgerGroups, setLedgerGroups] = useState<any[]>([]);

  // Items
  const [lines, setLines]       = useState<LineItem[]>([emptyLine()]);
  const [products, setProducts] = useState<any[]>([]);
  const [showGst, setShowGst]   = useState(false);

  // Ledger rows (auto + user)
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [allLedgers, setAllLedgers] = useState<any[]>([]); // all from customer table (other ledgers)
  const [taxLedgerIds, setTaxLedgerIds] = useState<{ cgst: number|null; sgst: number|null; igst: number|null }>({ cgst: null, sgst: null, igst: null });

  const [submitting, setSubmitting] = useState(false);
  const [remark, setRemark]         = useState('');

  // Keyboard navigation
  const [activeDropIdx, setActiveDropIdx] = useState(-1);
  const formRef = useRef<HTMLFieldSetElement>(null);

  // Batch popup
  const [batchPopupIdx, setBatchPopupIdx] = useState<number | null>(null);
  const [batchDraft, setBatchDraft]       = useState<BatchRow[]>([]);
  const [batchSerials, setBatchSerials]   = useState<string[]>([]);
  const [batchNoFlavour, setBatchNoFlavour] = useState(false);
  const [batchSerialHiIdx, setBatchSerialHiIdx] = useState(-1);
  const batchScrollRef = useRef<HTMLDivElement>(null);

  // Bill allocation
  const [customerBillByBill, setCustomerBillByBill] = useState(false);
  const [billAllocOpen, setBillAllocOpen]           = useState(false);
  const [billAllocEntries, setBillAllocEntries]     = useState<{ id: string; type: 'New' | 'Agr.' | 'On Account'; refno: string; amount: number; direction?: string; refSearch?: string; refOpen?: boolean }[]>([]);
  const [pendingRefs, setPendingRefs]               = useState<{ billname: string; amount: number; vch_date: string; vch_no: string; direction: string }[]>([]);
  const [pendingRefsDir, setPendingRefsDir]         = useState<string>('Cr');

  // Derived: system parents — filtered by allowed_vch_parent_ids if set
  const allowedVchParentIds: number[] = user?.permissions?.vouchers?.allowed_vch_parent_ids ?? [];
  const systemParents = allVchTypes.filter(t =>
    t.is_system === 1 &&
    (isAdmin() || allowedVchParentIds.length === 0 || allowedVchParentIds.includes(t.id))
  );
  const childTypes    = allVchTypes.filter(t =>
    selectedParentId === null || t.parent_id === selectedParentId || t.id === selectedParentId
  );

  const [voucherType, setVoucherType] = useState('');

  // Purchase mode = Purchase or Debit Note → user types serial no.
  // Sales mode    = Sales or Credit Note   → user searches & selects existing serial no.
  const isPurchaseMode = (() => {
    const vt = voucherType.toLowerCase();
    const parent = (allVchTypes.find(t => t.id === selectedParentId)?.name || '').toLowerCase();
    return vt.includes('purchase') || vt.includes('debit') || parent.includes('purchase') || parent.includes('debit');
  })();

  const isSalesType = (() => {
    const vt = voucherType.toLowerCase();
    const parent = (allVchTypes.find(t => t.id === selectedParentId)?.name || '').toLowerCase();
    return vt.includes('sales') || parent.includes('sales') || vt.includes('tax invoice') || parent.includes('tax invoice');
  })();

  // Journal mode = Contra / Journal / Payment / Receipt — no inventory, Dr/Cr ledger table
  const isStockJournal = (() => {
    const parent = (allVchTypes.find(t => t.id === selectedParentId)?.name || '').toLowerCase();
    const child = voucherType.toLowerCase();
    return parent.includes('stock journal') || child.includes('stock journal');
  })();

  const isJournalType = (() => {
    if (isStockJournal) return false;
    const parent = (allVchTypes.find(t => t.id === selectedParentId)?.name || '').toLowerCase();
    return parent.includes('contra') || parent.includes('journal') || parent.includes('payment') || parent.includes('receipt');
  })();

  // Stock Journal state
  const [stockSource, setStockSource] = useState<StockLine[]>([emptyStockLine()]);
  const [stockDest, setStockDest] = useState<StockLine[]>([emptyStockLine()]);
  // Batch popup: { side: 'src'|'dst', lineId: string } | null
  const [stockBatchPopup, setStockBatchPopup] = useState<{ side: 'src' | 'dst'; lineId: string } | null>(null);
  const stockBatchLine = stockBatchPopup
    ? (stockBatchPopup.side === 'src' ? stockSource : stockDest).find(l => l.id === stockBatchPopup.lineId) ?? null
    : null;

  // Journal rows state
  const [journalRows, setJournalRows] = useState<JournalRow[]>([emptyJournalRow(), emptyJournalRow()]);
  const [mobileStep, setMobileStep] = useState(1);
  // Which journal row's bill-allocation popup is currently open. The popup's
  // working state (billAllocEntries) is synced into this row's own billAlloc
  // array so each bill-by-bill row keeps its own independent allocations.
  const [activeJournalRowId, setActiveJournalRowId] = useState<string | null>(null);
  // When parent changes to something the current voucherType doesn't belong
  // to, default to its first child. Deliberately does NOT reset whenever
  // voucherType is already a valid child of selectedParentId — otherwise
  // this fires on every incidental re-render (allVchTypes refetch, a quick
  // link forcing a specific type, edit-mode Phase 2 resolving the real
  // type) and stomps a type someone/something else just deliberately set,
  // e.g. showing "Sales" with a blank item grid for a Payment voucher, or
  // silently reverting a "create Tax Invoice for this customer" quick link
  // back to whatever Sales' first child happens to be.
  useEffect(() => {
    if (params.id) return;
    if ((location.state as any)?.editVoucher?.id) return;
    const children = allVchTypes.filter(t => selectedParentId === null || t.parent_id === selectedParentId || t.id === selectedParentId);
    if (children.some(t => t.name === voucherType)) return;
    setVoucherType(children[0]?.name ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedParentId, allVchTypes, params.id, (location.state as any)?.editVoucher?.id]);

  // Auto-generate voucher number when type changes (only for new vouchers, not editing).
  // We ALSO check the URL/state edit signal because there's a race: the
  // first auto-numbering call fires before Phase-2 has set editId, so an
  // in-flight getNextNo response would otherwise land AFTER the edit-load
  // and overwrite the loaded voucher_no with a fresh one.
  useEffect(() => {
    if (editId) return; // don't overwrite when editing (post Phase-2)
    if ((location.state as any)?.editVoucher?.id) return; // edit nav incoming
    if (params.id) return; // URL-based edit route
    const vtId = childTypes.find(t => t.name === voucherType)?.id || selectedParentId;
    if (!vtId) return;
    vouchersApi.getNextNo(vtId, voucherDate).then((r: any) => {
      // Defensive double-check inside the callback in case editId got set
      // mid-flight (state nav).
      if (editId) return;
      if (r.success) setVoucherNo(r.data || ''); // clear if manual (empty string)
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherType, selectedParentId, editId, voucherDate]);

  // ----- Data loading -----
  useEffect(() => {
    // Captured once at mount: are we opening this page to edit an existing
    // voucher? If so, Phase 2 (below) owns selectedParentId/voucherType —
    // defaulting to Sales here would otherwise race it.
    const isEditRoute = !!params.id || !!(location.state as any)?.editVoucher?.id;
    vchTypeApi.getAll().then((r: any) => {
      if (r.success) {
        setAllVchTypes(r.data);
        if (!isEditRoute) {
          // Default select first system parent
          // Default to Sales (preferred) or first system type
          const salesType = r.data.find((t: VchTypeItem) => t.is_system === 1 && t.name === 'Sales');
          const firstParent = salesType || r.data.find((t: VchTypeItem) => t.is_system === 1);
          if (firstParent) setSelectedParentId(firstParent.id);
        }
      }
    }).catch(() => {});
    itemsApi.getAll().then(r => { if (r.success) setProducts(r.data); }).catch(() => {});
    // Load all ledger accounts from other-ledgers (non-sundry debtors: CGST, SGST, IGST, etc.)
    otherLedgerApi.getAll().then((r: any) => {
      const data: any[] = r.success ? r.data : (Array.isArray(r) ? r : []);
      setAllLedgers(data);
      // Pre-find tax ledger IDs by name
      const find = (name: string) => data.find((l: any) => (l.company || '').toUpperCase() === name)?.id ?? null;
      setTaxLedgerIds({ cgst: find('CGST'), sgst: find('SGST'), igst: find('IGST') });
    }).catch(() => {});
  }, []);

  // Ref to hold latest handleSubmit so the global-key useEffect doesn't
  // need it in its dependency list (it's defined further down in the file).
  const handleSubmitRef = useRef<() => void>(() => {});

  // 1. Global Keyboard Controller (Shortcuts)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      // Save: Alt + S
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSubmitRef.current();
      }
      // Switch types: F4 - F9 (Tally style)
      const typeMap: Record<string, string> = {
        'f4': 'Contra',
        'f5': 'Payment',
        'f6': 'Receipt',
        'f7': 'Journal',
        'f8': 'Sales',
        'f9': 'Purchase',
      };
      const type = typeMap[e.key.toLowerCase()];
      if (type) {
        e.preventDefault();
        const p = allVchTypes.find(t => t.is_system === 1 && t.name === type);
        if (p) setSelectedParentId(p.id);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [allVchTypes]);

  const moveFocus = (current: HTMLElement, direction: 'forward' | 'backward' | 'up' | 'down') => {
    // Find the nearest container (either a modal or the main form)
    const container = current.closest('.fixed, fieldset') as HTMLElement || formRef.current;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    )) as HTMLElement[];
    const index = focusable.indexOf(current);
    if (index === -1) return;

    if (direction === 'forward') {
      if (index < focusable.length - 1) focusable[index + 1].focus();
      else if (container.classList.contains('fixed')) {
         // Loop in modal or stay on last button? Stay on last for safety.
      }
    } else if (direction === 'backward') {
      if (index > 0) focusable[index - 1].focus();
    } else if (direction === 'up' || direction === 'down') {
      // Find element in same column of next/prev row
      const field = current.getAttribute('data-field');
      const rowIdx = parseInt(current.getAttribute('data-row') || '-1', 10);
      if (field && rowIdx !== -1) {
        const targetRow = direction === 'up' ? rowIdx - 1 : rowIdx + 1;
        const target = container.querySelector(`[data-field="${field}"][data-row="${targetRow}"]`) as HTMLElement;
        if (target) target.focus();
      } else if (direction === 'down' && index < focusable.length - 1) {
         focusable[index+1].focus();
      } else if (direction === 'up' && index > 0) {
         focusable[index-1].focus();
      }
    }
  };

  const focusNext = (target: HTMLElement) => {
    setTimeout(() => moveFocus(target, 'forward'), 30);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const target = e.currentTarget;

    // Tally Style: Enter/Tab moves forward
    if (e.key === 'Enter') {
      e.preventDefault();

      // 1. Dropdown open? Pick the highlighted item — and if nothing is
      //    explicitly highlighted yet, default to the FIRST option so a
      //    user typing fast can press Enter without ever pressing Down.
      if (showCustomerDrop && customers.length > 0) {
        const idx = activeDropIdx >= 0 ? activeDropIdx : 0;
        if (customers[idx]) {
          selectParty(customers[idx]);
          setActiveDropIdx(-1);
          focusNext(target); // jump to next field (item dropdown / etc.)
          return;
        }
      }

      const journalOpen = journalRows.find(r => r.open);
      if (journalOpen && journalOpen.results.length > 0) {
        const idx = activeDropIdx >= 0 ? activeDropIdx : 0;
        const l = journalOpen.results[idx];
        if (l) {
          const isBillByBill = l.billbybill === 'Yes';
          setJournalRows(p => p.map(r => r.id === journalOpen.id
            ? { ...r, ledger_id: l.id, ledger_name: l.company, search: l.company, open: false, billByBill: isBillByBill, billAlloc: isBillByBill ? r.billAlloc : [] }
            : r));
          setActiveDropIdx(-1);
          focusNext(target); // jump to amount column
          return;
        }
      }

      const ledgerOpen = ledgerRows.find(r => r.open);
      if (ledgerOpen) {
        const options = ledgerOptions(ledgerOpen.search);
        if (options.length > 0) {
          const idx = activeDropIdx >= 0 ? activeDropIdx : 0;
          if (options[idx]) {
            selectLedger(ledgerOpen.id, options[idx]);
            setActiveDropIdx(-1);
            focusNext(target); // jump to amount column
            return;
          }
        }
      }

      // Item picker (custom dropdown, replaces native <select>).
      // Pick only if (a) the user explicitly highlighted via Down (idx>0),
      // (b) there's an EXACT name match for the typed query, or (c) there's
      // exactly one match. Otherwise let the user keep typing — typing "s"
      // shouldn't auto-pick "SAMPLE8585" just because it's first.
      const openLineIdx = lines.findIndex(l => l.item_open);
      if (openLineIdx >= 0) {
        const ln = lines[openLineIdx];
        const q = (ln.item_search ?? '').trim().toLowerCase();
        const matches = products
          .filter((p: any) => !q || (p.item_name || '').toLowerCase().includes(q))
          .slice(0, 50);
        let pickIdx: number | null = null;
        if (activeDropIdx > 0) pickIdx = activeDropIdx;
        else if (matches.length === 1) pickIdx = 0;
        else if (q) {
          const exact = matches.findIndex((p: any) => (p.item_name || '').toLowerCase() === q);
          if (exact >= 0) pickIdx = exact;
        }
        if (pickIdx !== null && matches[pickIdx]) {
          const p = matches[pickIdx];
          updateLine(openLineIdx, 'product_id', String(p.id));
          updateLine(openLineIdx, 'item_name', p.item_name);
          updateLine(openLineIdx, 'item_search', '');
          updateLine(openLineIdx, 'item_open', false);
          if (p.batch === 'Yes') {
            setTimeout(() => openBatchPopup(openLineIdx, String(p.id)), 0);
          } else if (p.category_id === CLOUD_CATEGORY_ID) {
            setTimeout(() => openCloudPopup(openLineIdx), 0);
          }
          setActiveDropIdx(-1);
          focusNext(target); // jump to Qty column
          return;
        }
        // No clean match — close dropdown but stay on the field so the
        // user can keep typing. Don't move focus, don't auto-pick.
        return;
      }

      // 2. Smart Skip Logic: If on a blank selector, skip to next section
      if (target.tagName === 'SELECT' && (target as HTMLSelectElement).value === '') {
          const field = target.getAttribute('data-field');
          if (field === 'item') {
              // Skip items -> focus Remark
              const rem = formRef.current?.querySelector('[placeholder="Remark (optional)"]') as HTMLElement;
              if (rem) { rem.focus(); return; }
          }
      }
      if (target.tagName === 'INPUT' && target.getAttribute('data-field') === 'ledger-search' && (target as HTMLInputElement).value === '') {
          // Skip ledgers -> focus Remark
          const rem = formRef.current?.querySelector('[placeholder="Remark (optional)"]') as HTMLElement;
          if (rem) { rem.focus(); return; }
      }

      // Normal move forward
      moveFocus(target, 'forward');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      moveFocus(target, e.shiftKey ? 'backward' : 'forward');
    } else if (e.key === 'Backspace') {
      const input = target as HTMLInputElement;
      if (input.tagName === 'INPUT' && (input.value === '' || input.selectionStart === 0)) {
        e.preventDefault();
        moveFocus(target, 'backward');
      }
    } else if (e.key === 'ArrowDown') {
      const itemOpenLine = lines.find(l => l.item_open);
      const anyOpen = showCustomerDrop || journalRows.some(r => r.open) || ledgerRows.some(r => r.open) || !!itemOpenLine;
      if (anyOpen) {
        e.preventDefault();
        // Determine list length
        let len = 0;
        const jOpen = journalRows.find(r => r.open);
        const lOpen = ledgerRows.find(r => r.open);
        if (showCustomerDrop) len = customers.length;
        else if (jOpen) len = jOpen.results.length;
        else if (lOpen) len = ledgerOptions(lOpen.search).length;
        else if (itemOpenLine) {
          const q = (itemOpenLine.item_search ?? '').toLowerCase();
          len = products.filter((p: any) => !q || (p.item_name || '').toLowerCase().includes(q)).slice(0, 50).length;
        }
        setActiveDropIdx(p => Math.min(p + 1, (len || 20) - 1));
      } else {
        moveFocus(target, 'down');
      }
    } else if (e.key === 'ArrowUp') {
      const anyOpen = showCustomerDrop || journalRows.some(r => r.open) || ledgerRows.some(r => r.open) || lines.some(l => l.item_open);
      if (anyOpen) {
        e.preventDefault();
        setActiveDropIdx(p => Math.max(p - 1, 0));
      } else {
        moveFocus(target, 'up');
      }
    } else if (e.key === 'Escape') {
      setShowCustomerDrop(false);
      setJournalRows(p => p.map(r => ({ ...r, open: false })));
      setLedgerRows(p => p.map(r => ({ ...r, open: false })));
      setLines(p => p.map(l => ({ ...l, item_open: false })));
      setActiveDropIdx(-1);
    }
  };

  // ── Lead prefill (Bill & Close flow) ──
  // When ?lead_id=X is present, fetch the lead, set the party from its
  // customer_id, and copy the lead remark as a starting voucher remark.
  // Also fetches the customer record so billbybill/state/IGST flags are
  // applied — same side-effects pickCustomer() runs when a user picks via
  // the dropdown. Without this, customerBillByBill stays false and the
  // Grand Total isn't clickable for bill allocation.
  // Runs once per leadId so user edits aren't overwritten on re-render.
  useEffect(() => {
    if (!linkedLeadId) return;
    (async () => {
      try {
        const res: any = await leadRequirementsApi.getLeadDetail(linkedLeadId);
        const lead = res?.data?.lead;
        if (!lead) {
          showError('Lead not found', 'The linked lead could not be loaded.');
          setLinkedLeadId(null);
          return;
        }
        if (lead.status === 'Closed' || lead.status === 'Cancelled') {
          showError('Lead already closed', `This lead is already ${lead.status} and cannot be billed again.`);
          setLinkedLeadId(null);
          navigate('/lead/pending', { replace: true });
          return;
        }
        if (!lead.customer_id) {
          showError('No customer linked', 'This lead has no customer mapped — use Close/Join first to link a customer, then Complete.');
          setLinkedLeadId(null);
          navigate('/lead/pending', { replace: true });
          return;
        }
        setLinkedLeadInfo({
          customer_name: lead.customer_name,
          mobile_no: lead.mobile_no,
          lead_type: lead.lead_type,
        });
        // Fetch the full customer record so we can apply the same side
        // effects pickCustomer() runs (state lookup → IGST + billbybill flag).
        try {
          const cr = await customersApi.getById(String(lead.customer_id));
          if (cr?.success && cr.data) {
            const c = cr.data;
            setPartyId(String(c.id));
            setPartyDisplay(c.company || lead.customer_name || '');
            // State / IGST resolution mirrors pickCustomer
            let stateName = '';
            if (c.state && isNaN(Number(c.state))) stateName = c.state;
            else if (c.pincode) {
              try {
                const { pincodeApi } = await import('../services/api');
                const pr = await pincodeApi.lookup(String(c.pincode).replace(/\D/g, ''));
                if (pr?.state && isNaN(Number(pr.state))) stateName = pr.state;
              } catch { /* ignore */ }
            }
            setPartyState(stateName);
            const igst = stateName ? stateName.toLowerCase() !== MY_STATE.toLowerCase() : false;
            setIsIgst(igst);
            setLines(prev => prev.map(l => calcLine(l, igst)));
            setCustomerBillByBill(c.billbybill === 'Yes');
            setBillAllocEntries([]);
          } else {
            // Fallback: minimal prefill if customer fetch fails
            setPartyId(String(lead.customer_id));
            setPartyDisplay(lead.customer_name || '');
          }
        } catch {
          setPartyId(String(lead.customer_id));
          setPartyDisplay(lead.customer_name || '');
        }
        // Seed voucher remark with the lead's remark/contact (user can edit)
        const seed = [lead.contact_person, lead.remark].filter(Boolean).join(' · ');
        if (seed) setRemark(seed);
      } catch (e: any) {
        showError('Lead load failed', e?.message || 'Could not fetch the linked lead');
        setLinkedLeadId(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedLeadId]);

  // ── Edit-mode loader (split into two phases) ──
  // Phase 1: fetch the voucher payload as soon as we have an id in
  // location.state. This deliberately does NOT wait for vchTypes / ledgers
  // because those endpoints can race or fail silently on permission errors,
  // which used to leave the form blank with the user staring at an empty
  // sidebar.
  const [editVoucherData, setEditVoucherData] = useState<any>(null);
  useEffect(() => {
    // Edit signal can come from either source:
    //  1. URL param  /billing/vouchers/edit/:id  (preferred — survives refresh)
    //  2. location.state.editVoucher.id          (legacy callers)
    const urlId   = params.id ? parseInt(params.id, 10) : NaN;
    const stateId = (location.state as any)?.editVoucher?.id;
    const editId  = !isNaN(urlId) ? urlId : stateId;
    if (!editId) { setEditVoucherData(null); return; }
    vouchersApi.getById(editId)
      .then(res => { if (res.success && res.data) setEditVoucherData(res.data); })
      .catch(() => {});
  }, [params.id, (location.state as any)?.editVoucher?.id]);

  // Phase 2: apply the fetched payload to form state. Re-runs as
  // vchTypes / ledgers stream in so even if those load late, the type
  // dropdown / party state get filled in correctly.
  useEffect(() => {
    const v = editVoucherData;
    if (!v) return;
    editIdRef.current = v.id;
    setEditId(v.id);
    setMobileStep(2); // skip type-selection screen when editing

      // 1. Voucher type — prefer matching against the loaded allVchTypes
      //    (so children of the parent type populate correctly). When that
      //    list hasn't loaded (vchtypes API gated by separate permission),
      //    fall back to the response's own vch_type_name so the dropdown
      //    still shows "Sales"/"Purchase"/etc. instead of "-- No types --".
      const vt = allVchTypes.find(t => t.id === v.vch_type_id);
      if (vt) {
        const parentId = vt.parent_id && vt.parent_id !== vt.id ? vt.parent_id : vt.id;
        setSelectedParentId(parentId);
        setVoucherType(vt.name);
      } else if (v.vch_type_name) {
        setVoucherType(v.vch_type_name);
        if (v.vch_type_parent_id) setSelectedParentId(v.vch_type_parent_id);
      }

      // 2. Header fields
      setVoucherNo(v.vch_no || '');
      setVoucherDate(v.vch_date ? v.vch_date.split('T')[0] : '');
      setRemark(v.remark || '');
      setCheckedBy(v.checked_by || null);
      setCheckedAt(v.checked_at || null);

      // This voucher was saved without a number (e.g. imported, or created
      // before automatic numbering was set up for its type). Suggest one now,
      // same as a brand-new voucher would get, so it can be numbered on save.
      // Guarded so it never overwrites an already-assigned number or a number
      // the user is mid-typing: only applies if vch_no was empty on load, and
      // only lands if the field is STILL empty and we're still on this voucher.
      if (!v.vch_no && v.vch_type_id) {
        vouchersApi.getNextNo(v.vch_type_id, v.vch_date ? v.vch_date.split('T')[0] : undefined)
          .then((r: any) => {
            if (r.success && r.data && editIdRef.current === v.id) {
              setVoucherNo(current => current || r.data);
            }
          }).catch(() => {});
      }

      // 3. Party — also resolve state to set isIgst correctly
      setPartyId(String(v.party_ledger_id));
      // party_name comes from customer JOIN; fall back to ledger entry name
      // in case the customer row was deleted or the party is a non-customer ledger
      const partyEntryName = (v.ledgerEntries || []).find(
        (le: any) => String(le.ledger_id) === String(v.party_ledger_id)
      )?.ledger_name;
      setPartyDisplay(v.party_name || partyEntryName || '');
      const partyLedger = allLedgers.find((l: any) => l.id === v.party_ledger_id);
      const partyStateName = partyLedger?.state || '';
      const editIgst = partyStateName ? partyStateName.toLowerCase() !== MY_STATE.toLowerCase() : false;
      setPartyState(partyStateName);
      setIsIgst(editIgst);

      // Restore customerBillByBill for items-mode vouchers. Without this,
      // re-saving sends bill_allocation: undefined and the backend wipes the
      // outstanding entries. Use the party's billbybill flag from allLedgers,
      // falling back to "the voucher already has bill allocations" as proof.
      if (partyLedger?.billbybill === 'Yes' || (v.billAllocations?.length ?? 0) > 0) {
        setCustomerBillByBill(true);
      }

      // 4. Split ledger entries
      // Note: inventory hangs on the GOODS ledger entry (Purchase/Sales), NOT the party ledger entry
      const allEntries: any[] = v.ledgerEntries || [];
      // Find the entry that actually has inventory (could be Purchase/Sales row, not party row)
      const inventoryEntry = allEntries.find((le: any) => le.inventoryEntries?.length > 0);
      // Exclude both party entry AND goods/inventory entry (both are auto-managed by the system)
      const otherEntries: any[] = allEntries.filter((le: any) =>
        String(le.ledger_id) !== String(v.party_ledger_id) &&
        le.id !== inventoryEntry?.id
      );

      // 5. Item lines (from inventory entry) — including batch rows
      if (inventoryEntry?.inventoryEntries?.length) {
        setLines(inventoryEntry.inventoryEntries.map((ie: any) => {
          const base = {
            product_id: String(ie.item_id),
            item_name: ie.item_name || '',
            qty: Math.abs(Number(ie.qty)),
            rate: Number(ie.rate),
            amount: Math.abs(Number(ie.amount)),
            gst_rate: Number(ie.gst_rate) || 0,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 0,
            line_total: Math.abs(Number(ie.amount)),
            batch_rows: (ie.batchRows || []).map((b: any) => ({
              batch_name: b.batch_name || '',
              qty: Math.abs(Number(b.qty)),
              rate: Number(b.rate),
              amount: Math.abs(Number(b.amount)),
            })),
          };
          // When qty=0 but amount>0 (amount-only batch entry), apply amount
          // directly so it isn't lost by qty*rate=0 in calcLine.
          return base.qty === 0 && base.amount > 0
            ? calcLineFromAmount(base, editIgst, base.amount)
            : calcLine(base, editIgst);
        }));
      }

      // 6. Determine if journal type / stock journal
      const parentName = (allVchTypes.find(t => t.id === (vt?.parent_id && vt.parent_id !== vt.id ? vt.parent_id : vt?.id))?.name || '').toLowerCase();
      const vtNameLc = (vt?.name || v.vch_type_name || '').toLowerCase();
      const isStockJournalEdit = parentName.includes('stock journal') || vtNameLc.includes('stock journal');
      const isJournal = !isStockJournalEdit && ['contra','journal','payment','receipt'].some(k => parentName.includes(k) || vtNameLc.includes(k));

      if (isStockJournalEdit) {
        // Load source and destination inventory entries from the dummy ledger entry
        const allInvEntries: any[] = (v.ledgerEntries || []).flatMap((le: any) => le.inventoryEntries || []);
        const mapStockLine = (ie: any) => {
          const batchRows = (ie.batchRows || []).map((b: any) => ({
            id: uid(),
            batch_name: b.batch_name || '',
            qty: Math.abs(Number(b.qty)),
            rate: Number(b.rate),
            amount: Math.abs(Number(b.amount)),
          }));
          return {
            id: uid(),
            item_id: String(ie.item_id),
            item_name: ie.item_name || '',
            search: ie.item_name || '',
            open: false,
            qty: Math.abs(Number(ie.qty)),
            rate: Number(ie.rate),
            amount: Math.abs(Number(ie.amount)),
            gst_rate: Number(ie.gst_rate) || 0,
            batch_yes: batchRows.length > 0,
            batch_rows: batchRows,
          };
        };
        const srcEntries = allInvEntries.filter(ie => ie.side === 'source');
        const dstEntries = allInvEntries.filter(ie => ie.side === 'destination');
        setStockSource(srcEntries.length ? srcEntries.map(mapStockLine) : [emptyStockLine()]);
        setStockDest(dstEntries.length ? dstEntries.map(mapStockLine) : [emptyStockLine()]);
      } else if (isJournal) {
        // Bill allocations are grouped by their own ledger (bill_allocation.ledger)
        // so each bill-by-bill ledger row gets back exactly its own allocations,
        // independent of which ledger happens to be the voucher's party_ledger_id.
        const allocsByLedger = new Map<string, any[]>();
        for (const ba of (v.billAllocations || [])) {
          const key = String(ba.ledger);
          if (!allocsByLedger.has(key)) allocsByLedger.set(key, []);
          allocsByLedger.get(key)!.push(ba);
        }
        // Journal rows: all ledger entries as Dr/Cr rows
        setJournalRows((v.ledgerEntries || []).map((le: any) => {
          const rowAllocs = allocsByLedger.get(String(le.ledger_id)) || [];
          return {
            id: uid(),
            drOrCr: Number(le.amount) >= 0 ? 'Dr' as const : 'Cr' as const,
            ledger_id: le.ledger_id,
            ledger_name: le.ledger_name || '',
            dr_amount: Number(le.amount) > 0 ? Number(le.amount) : 0,
            cr_amount: Number(le.amount) < 0 ? Math.abs(Number(le.amount)) : 0,
            search: le.ledger_name || '',
            open: false,
            results: [],
            billByBill: rowAllocs.length > 0,
            billAlloc: rowAllocs.map((ba: any) => ({
              id: uid(),
              type: 'Agr.' as const,
              refno: ba.billname || '',
              refSearch: ba.billname || '',
              amount: Math.abs(Number(ba.amount)),
              direction: Number(ba.amount) >= 0 ? 'Dr' : 'Cr',
            })),
          };
        }));
      } else {
        // Ledger rows for normal mode. Show ALL non-party / non-goods
        // entries, including tax rows (CGST / SGST / IGST / Roundoff), so
        // the user can SEE the full breakdown. Tax rows are tagged auto so
        // they're protected from the manual-edit handlers, and the auto-sync
        // effect that re-derives them from items uses the same `auto-cgst`
        // ids — replacing this row instead of duplicating it.
        if (otherEntries.length) {
          // Derive tax ledger IDs fresh from allLedgers to avoid stale-closure
          // race with taxLedgerIds state (both are set in the same async effect).
          const findId = (name: string) => allLedgers.find((l: any) => (l.company || '').toUpperCase() === name)?.id ?? null;
          const cgstId = findId('CGST'); const sgstId = findId('SGST'); const igstId = findId('IGST');
          const taxLedgerIdSet = new Set([cgstId, sgstId, igstId].filter(Boolean));

          // Deduplicate by ledger_id FIRST — tally imports often save duplicate
          // entries for the same ledger in a single voucher. Keep the first
          // occurrence (highest id = most recent if re-imported, but first is
          // fine since amounts should be identical).
          const seenLedgerIds = new Set<number>();
          const uniqueEntries = otherEntries.filter((le: any) => {
            if (!le.ledger_id) return true; // null-id rows always pass
            if (seenLedgerIds.has(le.ledger_id)) return false;
            seenLedgerIds.add(le.ledger_id);
            return true;
          });

          const mapped = uniqueEntries.map((le: any) => {
            // If the backend JOIN missed the name, fall back to allLedgers already in state
            const resolvedName = le.ledger_name ||
              (le.ledger_id ? (allLedgers.find((l: any) => l.id === le.ledger_id)?.company || '') : '');
            const name = resolvedName.toLowerCase();
            const isCgst = /^cgst$/.test(name) || name.includes('cgst') || le.ledger_id === cgstId;
            const isSgst = /^sgst$/.test(name) || name.includes('sgst') || le.ledger_id === sgstId;
            const isIgst = /^igst$/.test(name) || name.includes('igst') || le.ledger_id === igstId;
            const isRound = name.includes('round');
            const isTaxById = le.ledger_id && taxLedgerIdSet.has(le.ledger_id);
            const presetId =
              isCgst ? 'auto-cgst' :
              isSgst ? 'auto-sgst' :
              isIgst ? 'auto-igst' :
              isRound ? 'auto-roundoff' :
              uid();
            return {
              id: presetId,
              ledger_id: le.ledger_id,
              ledger_name: resolvedName,
              amount: Math.abs(Number(le.amount)),
              auto: isCgst || isSgst || isIgst || isTaxById,
              search: resolvedName,
              open: false,
            };
          });
          // Second dedup pass by row id (catches any remaining preset-id collisions)
          const deduped = Array.from(new Map(mapped.map(r => [r.id, r])).values());
          setLedgerRows(deduped);
        }
      }

      // 7. Bill allocations — non-journal (customer) mode only; journal-mode
      // allocations were already distributed into each row's own billAlloc above.
      if (!isJournal && v.billAllocations?.length) {
        setBillAllocEntries(v.billAllocations.map((ba: any) => ({
          id: uid(),
          type: 'Agr.' as const,
          refno: ba.billname || '',
          refSearch: ba.billname || '',
          amount: Math.abs(Number(ba.amount)),
          direction: Number(ba.amount) >= 0 ? 'Dr' : 'Cr',
        })));
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editVoucherData, allVchTypes.length, allLedgers.length]);

  // Sync print Bill To details whenever partyId / editVoucherData changes
  useEffect(() => {
    if (editVoucherData) {
      setPrintBillTo({
        name:     editVoucherData.party_name           || '',
        address1: editVoucherData.party_address1       || '',
        address2: editVoucherData.party_address2       || '',
        city:     editVoucherData.party_city           || '',
        state:    editVoucherData.party_state          || '',
        pincode:  editVoucherData.party_pincode ? String(editVoucherData.party_pincode) : '',
        gstin:    editVoucherData.party_gst            || '',
        phone:    editVoucherData.party_mobile ? String(editVoucherData.party_mobile) : '',
        email:    editVoucherData.party_email          || '',
        contact:  editVoucherData.party_contact_person || '',
      });
      // Fetch full customer details to merge any newer/fuller fields
      if (editVoucherData.party_ledger_id) {
        customersApi.getById(String(editVoucherData.party_ledger_id))
          .then(res => {
            if (res?.success && res.data) {
              const c = res.data;
              setPrintBillTo(prev => ({
                ...prev,
                address1: c.address1 || prev.address1,
                address2: c.address2 || prev.address2,
                city: c.pincode_city || c.city || prev.city,
                state: c.state_name || c.state || prev.state,
                pincode: c.pincode ? String(c.pincode) : prev.pincode,
                gstin: c.gstin || prev.gstin,
                phone: c.mobile ? String(c.mobile) : prev.phone,
                email: c.email || prev.email,
                contact: c.person || c.contact_person || prev.contact,
              }));
            }
          })
          .catch(() => {});
      }
    } else if (partyId) {
      customersApi.getById(partyId)
        .then(res => {
          if (res?.success && res.data) {
            const c = res.data;
            setPrintBillTo({
              name: c.company || partyDisplay || '',
              address1: c.address1 || '',
              address2: c.address2 || '',
              city: c.pincode_city || c.city || '',
              state: c.state_name || c.state || '',
              pincode: c.pincode ? String(c.pincode) : '',
              gstin: c.gstin || '',
              phone: c.mobile ? String(c.mobile) : '',
              email: c.email || '',
              contact: c.person || c.contact_person || '',
            });
          } else {
            setPrintBillTo(b => ({ ...b, name: partyDisplay, state: partyState }));
          }
        })
        .catch(() => {
          setPrintBillTo(b => ({ ...b, name: partyDisplay, state: partyState }));
        });
    } else {
      setPrintBillTo({
        name: '', address1: '', address2: '', city: '', state: '',
        pincode: '', gstin: '', phone: '', email: '', contact: ''
      });
    }
  }, [partyId, partyDisplay, editVoucherData, partyState]);

  // Live party autocomplete
  useEffect(() => {
    if (customerSearch.length < 2) {
      setCustomers([]);
      setShowCustomerDrop(false);
      return;
    }
    const t = setTimeout(() => {
      customersApi.search(customerSearch).then((r: any) => {
        const list = Array.isArray(r) ? r : (r?.data || []);
        setCustomers(list);
        if (list.length > 0) setShowCustomerDrop(true);
      }).catch((e: any) => {
        console.warn('[CustomerSearch] failed:', e?.message || e);
        setCustomers([]);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [customerSearch]);

  // Close party dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) setShowCustomerDrop(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ----- Party selection -----
  const selectParty = async (c: any) => {
    setPartyDisplay(c.company);
    setPartyId(String(c.id));
    setCustomerSearch('');
    setShowCustomerDrop(false);

    // state_name comes directly from autocomplete (pincode JOIN in backend)
    let stateName = (typeof c?.state_name === 'string' && isNaN(Number(c.state_name)))
      ? c.state_name : '';

    // Fallback: pincodeApi lookup if autocomplete didn't include state
    if (!stateName && c?.pincode && String(c.pincode).replace(/\D/g,'').length === 6) {
      try {
        const { pincodeApi } = await import('../services/api');
        const pr = await pincodeApi.lookup(String(c.pincode).replace(/\D/g,''));
        if (pr?.state && isNaN(Number(pr.state))) stateName = pr.state;
      } catch {}
    }

    setPartyState(stateName);
    const igst = stateName ? stateName.toLowerCase() !== MY_STATE.toLowerCase() : false;
    setIsIgst(igst);
    setLines(prev => prev.map(l => calcLine(l, igst)));
    setCustomerBillByBill(c.billbybill === 'Yes');
    setBillAllocEntries([]);
  };

  // Recalculate lines when GST type changes
  useEffect(() => {
    setLines(prev => prev.map(l => calcLine(l, isIgst)));
  }, [isIgst]);

  // ----- Totals -----
  const subtotal   = +lines.reduce((s, l) => s + l.amount, 0).toFixed(2);
  const totalCgst  = +lines.reduce((s, l) => s + l.cgst_amount, 0).toFixed(2);
  const totalSgst  = +lines.reduce((s, l) => s + l.sgst_amount, 0).toFixed(2);
  const totalIgst  = +lines.reduce((s, l) => s + l.igst_amount, 0).toFixed(2);
  // Exclude roundoff row from rawTotal to avoid circular dependency
  const ledgerTotal  = ledgerRows.filter(r => r.id !== 'auto-roundoff').reduce((s, r) => s + (r.amount || 0), 0);
  const rawTotal     = +(subtotal + ledgerTotal).toFixed(2);
  const roundoffAmt  = +(Math.round(rawTotal) - rawTotal).toFixed(2);
  const grandTotal   = +(rawTotal + roundoffAmt).toFixed(2);

  // ----- Auto-sync GST ledger rows (CGST/SGST/IGST) -----
  useEffect(() => {
    setLedgerRows(prev => {
      // Keep user rows except roundoff (managed separately)
      const user = prev.filter(r => !r.auto && r.id !== 'auto-roundoff');
      const roundoffRow = prev.find(r => r.id === 'auto-roundoff');
      const auto: LedgerRow[] = [];

      // Only emit auto tax rows when the matching ledger truly exists in the
      // backend. Skipping when ledger_id is null avoids showing labels the
      // user can't actually transact against — and matches the backend's
      // per-item GST persistence (which derives totals from items[] regardless).
      if (!isIgst) {
        if (totalCgst > 0 && taxLedgerIds.cgst) {
          const led = allLedgers.find(l => l.id === taxLedgerIds.cgst);
          auto.push({
            id: 'auto-cgst', ledger_id: taxLedgerIds.cgst,
            ledger_name: led?.company || 'CGST',
            amount: totalCgst, auto: true, search: led?.company || 'CGST', open: false,
          });
        }
        if (totalSgst > 0 && taxLedgerIds.sgst) {
          const led = allLedgers.find(l => l.id === taxLedgerIds.sgst);
          auto.push({
            id: 'auto-sgst', ledger_id: taxLedgerIds.sgst,
            ledger_name: led?.company || 'SGST',
            amount: totalSgst, auto: true, search: led?.company || 'SGST', open: false,
          });
        }
      } else {
        if (totalIgst > 0 && taxLedgerIds.igst) {
          const led = allLedgers.find(l => l.id === taxLedgerIds.igst);
          auto.push({
            id: 'auto-igst', ledger_id: taxLedgerIds.igst,
            ledger_name: led?.company || 'IGST',
            amount: totalIgst, auto: true, search: led?.company || 'IGST', open: false,
          });
        }
      }

      const restored = auto.map(a => {
        const existing = prev.find(p => p.id === a.id);
        if (existing && existing.ledger_id && existing.ledger_id !== a.ledger_id) {
          return { ...a, ledger_id: existing.ledger_id, ledger_name: existing.ledger_name, search: existing.search };
        }
        return a;
      });

      // Preserve roundoff row position at the end
      return roundoffRow ? [...restored, ...user, roundoffRow] : [...restored, ...user];
    });
  }, [totalCgst, totalSgst, totalIgst, isIgst, taxLedgerIds]);

  // ----- Auto-sync Roundoff ledger row -----
  useEffect(() => {
    const roundoffLedger = allLedgers.find(l => /round/i.test(l.company || ''));
    setLedgerRows(prev => {
      const withoutRoundoff = prev.filter(r => r.id !== 'auto-roundoff');
      if (roundoffAmt === 0) return withoutRoundoff;
      const existing = prev.find(r => r.id === 'auto-roundoff');
      return [...withoutRoundoff, {
        id: 'auto-roundoff',
        ledger_id: existing?.ledger_id ?? (roundoffLedger?.id || null),
        ledger_name: existing?.ledger_name ?? (roundoffLedger?.company || 'Roundoff'),
        amount: roundoffAmt,
        auto: false,  // editable
        search: existing?.search ?? (roundoffLedger?.company || 'Roundoff'),
        open: false,
      }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTotal]);

  // ----- Line item updates -----
  const updateLine = useCallback((idx: number, field: keyof LineItem, value: any) => {
    setLines(prev => {
      const updated = [...prev];
      let line = { ...updated[idx], [field]: value };
      if (field === 'product_id') {
        const prod = products.find(p => String(p.id) === String(value));
        if (prod) { line.item_name = prod.item_name; line.gst_rate = Number(prod.gst) || 0; }
      }
      if (field === 'amount') {
        line = calcLineFromAmount(line, isIgst, Number(value) || 0);
      } else if (['product_id', 'qty', 'rate', 'gst_rate'].includes(field as string)) {
        line = calcLine(line, isIgst);
      }
      updated[idx] = line;
      return updated;
    });
  }, [products, isIgst]);

  const addRow    = () => setLines(p => [...p, emptyLine()]);
  const removeRow = (idx: number) => { if (lines.length > 1) setLines(p => p.filter((_, i) => i !== idx)); };

  // ----- Ledger row management -----
  const addLedgerRow = () => setLedgerRows(p => [...p, {
    id: uid(), ledger_id: null, ledger_name: '', amount: 0, auto: false, search: '', open: false,
  }]);

  const removeLedgerRow = (id: string) => setLedgerRows(p => p.filter(r => r.id !== id));

  const updateLedgerRow = (id: string, patch: Partial<LedgerRow>) =>
    setLedgerRows(p => p.map(r => r.id === id ? { ...r, ...patch } : r));

  const selectLedger = (rowId: string, l: any) =>
    updateLedgerRow(rowId, { ledger_id: l.id, ledger_name: l.company, search: l.company, open: false });

  // Auto-focus the first interactive input inside a popup when it opens, so
  // keyboard-only users don't have to mouse into the modal.
  useEffect(() => {
    if (batchPopupIdx === null) return;
    setTimeout(() => {
      const el = batchPopupRef.current?.querySelector('input:not([disabled]):not([type="hidden"])') as HTMLInputElement | null;
      el?.focus();
    }, 50);
  }, [batchPopupIdx]);

  useEffect(() => {
    if (!showNewCustomer) return;
    setTimeout(() => {
      const el = newCustomerPopupRef.current?.querySelector('input:not([disabled]):not([type="hidden"])') as HTMLInputElement | null;
      el?.focus();
    }, 50);
    // Ledger group options for the new party (default Sundry Debtors)
    if (ledgerGroups.length === 0) {
      ledgerGroupApi.getAll()
        .then(res => { if (res.success) setLedgerGroups(res.data || []); })
        .catch(() => { /* dropdown just stays with the default */ });
    }
  }, [showNewCustomer]);

  useEffect(() => {
    if (!billAllocOpen) return;
    setTimeout(() => {
      const el = billAllocPopupRef.current?.querySelector('input:not([disabled]):not([type="hidden"])') as HTMLInputElement | null;
      el?.focus();
    }, 50);
  }, [billAllocOpen]);

  useEffect(() => {
    if (!cloudPopup) return;
    setTimeout(() => {
      const el = cloudPopupRef.current?.querySelector('input[type="checkbox"]:not([disabled])') as HTMLInputElement | null;
      el?.focus();
    }, 50);
  }, [cloudPopup?.lineIdx]);

  // Helper: open the cloud picker for a given voucher line.
  // Credit Note → fetch purchase activities (server-mapped to customer).
  // All other types → fetch billing activities (Sales) for the customer.
  const openCloudPopup = async (lineIdx: number) => {
    if (!partyId) {
      showError('Pick customer first', 'Select the customer before adding a Cloud-category item.');
      return;
    }
    const isCreditNote = voucherType.toLowerCase().includes('credit');
    setCloudPopup({ lineIdx, activities: [], selectedIds: new Set(), loading: true, isCreditNote });
    try {
      // When editing an existing voucher, pass its id so the backend also
      // returns activities already linked to THIS voucher (not just
      // unbilled ones) — otherwise re-opening this popup on an edit makes
      // the previously-picked activities vanish (they read as "billed"),
      // and the user loses track of what was selected before.
      const res = isCreditNote
        ? await activitiesApi.getPendingPurchaseByCustomer(partyId, editId ?? undefined)
        : await activitiesApi.getPendingByCustomer(partyId, editId ?? undefined);
      const list = res.success ? res.data : [];
      const preSelected = new Set(
        list.filter((a: any) => editId && String(a.voucher_id) === String(editId)).map((a: any) => String(a.id))
      );
      setCloudPopup(prev => prev && prev.lineIdx === lineIdx
        ? { ...prev, activities: list, selectedIds: preSelected, loading: false }
        : prev);
    } catch (e: any) {
      showError('Error', e.message || 'Failed to load pending activities');
      setCloudPopup(null);
    }
  };

  // Confirm selection → fill the line with the summed amount, mark
  // activity ids for post-save linking.
  const applyCloudSelection = () => {
    if (!cloudPopup) return;
    const selected = cloudPopup.activities.filter(a => cloudPopup.selectedIds.has(String(a.id)));
    if (!selected.length) {
      showError('No selection', 'Select at least one activity to bill.');
      return;
    }
    const getActivityAmt = (a: any) => cloudPopup.isCreditNote
      ? (Number(a.purchase_amount) > 0 ? Number(a.purchase_amount) : Number(a.bill_amount || 0))
      : Number(a.bill_amount || 0);
    const total = +selected.reduce((s, a) => s + getActivityAmt(a), 0).toFixed(2);
    // For Cloud lines: qty=1, rate=total, amount=total. Internally consistent
    // with inventory_entries.qty/rate (which are NOT NULL), but the user only
    // supplies the amount.
    setLines(prev => {
      const updated = [...prev];
      updated[cloudPopup.lineIdx] = calcLine({
        ...updated[cloudPopup.lineIdx],
        qty: 1,
        rate: total,
        amount: total,
      }, isIgst);
      return updated;
    });
    setActivitiesToLink(prev => Array.from(new Set([...prev, ...selected.map(a => String(a.id))])));
    setCloudPopup(null);
  };

  const toggleCloudActivity = (id: string) => {
    setCloudPopup(prev => {
      if (!prev) return prev;
      const next = new Set(prev.selectedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, selectedIds: next };
    });
  };

  // ----- Batch popup helpers -----
  const openBatchPopup = async (idx: number, overrideProductId?: string) => {
    const existing = lines[idx].batch_rows;
    const draft = existing?.length
      ? existing.map(r => ({ ...r, serialSearch: r.batch_name, serialOpen: false }))
      : [{ id: uid(), batch_name: '', qty: 0, rate: 0, amount: 0, serialSearch: '', serialOpen: false }];
    setBatchDraft(draft);
    setBatchPopupIdx(idx);
    setBatchSerials([]);

    // Sales/Credit Note: fetch existing serial nos for search-and-select
    // Purchase/Debit Note: user types manually — no fetch needed
    setBatchNoFlavour(false);
    if (!isPurchaseMode && partyId) {
      const resolvedProductId = overrideProductId ?? lines[idx].product_id;
      const prod = products.find((p: any) => String(p.id) === String(resolvedProductId));
      const flavourId = prod?.tally_flavour_id || undefined;
      if (!flavourId) {
        // Item has no flavour configured — cannot filter serials by product
        setBatchNoFlavour(true);
        setBatchSerials([]);
      } else {
        try {
          const res = await vouchersApi.getSerials(parseInt(partyId, 10), flavourId);
          if (res.success) setBatchSerials(res.data);
        } catch { setBatchSerials([]); }
      }
    }
  };

  const saveBatch = () => {
    if (batchPopupIdx === null) return;
    // Reject empty serial/batch numbers right here so the user can't dismiss
    // the popup with a blank field and end up with a batch=Yes line that
    // has no traceability after save.
    const targetLine = lines[batchPopupIdx];
    const prod = targetLine ? products.find((p: any) => String(p.id) === String(targetLine.product_id)) : null;
    if (prod?.batch === 'Yes') {
      // Allow rows that have qty>0 OR amount>0 — qty is optional when amount is entered directly
      const rowsWithValue = batchDraft.filter(r => r.qty > 0 || r.amount > 0);
      if (rowsWithValue.length === 0) {
        showError('Validation', `"${prod.item_name}" requires at least one batch row with a serial number and an amount.`);
        return;
      }
      const blankIdx = rowsWithValue.findIndex(r => !(r.batch_name || '').trim());
      if (blankIdx !== -1) {
        showError('Validation', `Serial / batch number is empty for row ${blankIdx + 1}. Enter the serial before saving.`);
        return;
      }
    }
    // Accept rows with qty>0 OR amount>0 (serial-only with a direct amount is valid)
    const valid = batchDraft.filter(r => r.qty > 0 || r.amount > 0);
    const totalQty    = +valid.reduce((s, r) => s + r.qty, 0).toFixed(3);
    const totalAmount = +valid.reduce((s, r) => s + r.amount, 0).toFixed(2);
    const avgRate     = totalQty > 0 ? +(totalAmount / totalQty).toFixed(4) : 0;
    setLines(prev => {
      const updated = [...prev];
      const base = { ...updated[batchPopupIdx], qty: totalQty, rate: avgRate };
      // When qty=0 but amount>0, apply amount directly so it isn't computed as qty*rate=0
      const line = totalQty === 0 && totalAmount > 0
        ? { ...calcLineFromAmount(base, isIgst, totalAmount), batch_rows: valid }
        : { ...calcLine(base, isIgst), batch_rows: valid };
      updated[batchPopupIdx] = line;
      return updated;
    });
    setBatchPopupIdx(null);
    setBatchDraft([]);
  };

  // ----- New customer -----
  const handleCreateCustomer = async () => {
    if (!custForm.company.trim()) { showError('Validation', 'Company name is required'); return; }
    if (!custForm.mobile.trim())  { showError('Validation', 'Mobile is required'); return; }
    setCreatingCustomer(true);
    try {
      const res = await customersApi.create({
        company: custForm.company.trim(), mobile: custForm.mobile.trim(),
        gstin: custForm.gstin.trim() || undefined, email: custForm.email.trim() || undefined,
        pincode: custForm.pincode.trim() || undefined, address1: custForm.address1.trim() || undefined,
        address2: custForm.address2.trim() || undefined, area: custForm.area.trim() || undefined,
        state: custForm.state.trim() || undefined, status: 'Active',
        ledgergroup: custForm.ledgergroup || SUNDRY_DEBTORS_ID,
      } as any);
      if (res.success && res.data) {
        setPartyDisplay(res.data.company || custForm.company);
        setPartyId(String(res.data.id));
        const st = res.data.state || custForm.state || '';
        setPartyState(st);
        setIsIgst(st ? st.toLowerCase() !== MY_STATE.toLowerCase() : false);
        setShowNewCustomer(false);
        setCustForm(blankCustForm());
        showSuccess('Created', 'Customer created');
      }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setCreatingCustomer(false); }
  };

  // ----- Journal totals -----
  const journalDrTotal = +journalRows.filter(r => r.drOrCr === 'Dr').reduce((s, r) => s + r.dr_amount, 0).toFixed(2);
  const journalCrTotal = +journalRows.filter(r => r.drOrCr === 'Cr').reduce((s, r) => s + r.cr_amount, 0).toFixed(2);
  const journalBalanced = Math.abs(journalDrTotal - journalCrTotal) < 0.01;

  // The row whose bill-allocation popup is currently open (per-row model).
  const activeJournalRow = activeJournalRowId ? journalRows.find(r => r.id === activeJournalRowId) ?? null : null;
  const activeRowAmount = activeJournalRow ? (activeJournalRow.drOrCr === 'Dr' ? activeJournalRow.dr_amount : activeJournalRow.cr_amount) : 0;

  const effectiveGrandTotal = isJournalType
    ? (activeJournalRow ? activeRowAmount : journalDrTotal)
    : grandTotal;

  // Bill allocation required if ANY row has ledger (bill-by-bill rows need popup; non-bill-by-bill get auto On Account)
  const journalBillByBill = isJournalType && journalRows.some(r => r.ledger_id && (r.dr_amount > 0 || r.cr_amount > 0));

  // ----- Bill allocation helpers -----
  // Party direction determines sign of grand total
  // Journal: use the active row's drOrCr | Normal: Purchase/Debit Note → Cr, Sales/Credit Note → Dr
  const partyDir: 'Dr' | 'Cr' = isJournalType
    ? (activeJournalRow ? activeJournalRow.drOrCr : 'Cr')
    : (isPurchaseMode ? 'Cr' : 'Dr');
  const signedGrandTotal = partyDir === 'Dr' ? effectiveGrandTotal : -effectiveGrandTotal;

  // Signed sum: Cr entries = negative, Dr entries = positive
  const billAllocSigned = +billAllocEntries.reduce((s, e) => {
    const amt = Number(e.amount) || 0;
    return s + (e.direction === 'Cr' ? -amt : amt);
  }, 0).toFixed(2);

  // Balance = signedGrandTotal − billAllocSigned → 0 when fully allocated
  const billAllocBalance  = +(signedGrandTotal - billAllocSigned).toFixed(2);
  const billAllocTotal    = Math.abs(billAllocSigned); // absolute for display
  const billAllocBalanced = !(customerBillByBill || journalBillByBill) || Math.abs(billAllocBalance) < 0.01;

  const isRowBillAllocBalanced = (r: JournalRow) => {
    const amt = r.drOrCr === 'Dr' ? r.dr_amount : r.cr_amount;
    const signed = r.drOrCr === 'Dr' ? amt : -amt;
    const allocSigned = r.billAlloc.reduce((s, e) => s + (e.direction === 'Cr' ? -(Number(e.amount) || 0) : (Number(e.amount) || 0)), 0);
    return Math.abs(signed - allocSigned) < 0.01;
  };

  // Whether ALL bill-by-bill rows are individually balanced (used to gate submit)
  const allRowsBillAllocBalanced = !journalBillByBill || journalRows.filter(r => r.billByBill && r.ledger_id && (r.dr_amount > 0 || r.cr_amount > 0)).every(isRowBillAllocBalanced);

  // First bill-by-bill row that still needs allocation
  const firstBillAllocRowId = (() => {
    const billByBillRows = journalRows.filter(r => r.billByBill && r.ledger_id && (r.dr_amount > 0 || r.cr_amount > 0));
    if (billByBillRows.length === 0) return null;
    const unbalanced = billByBillRows.find(r => !isRowBillAllocBalanced(r));
    return (unbalanced || billByBillRows[0]).id;
  })();

  // Opens the bill-alloc popup for the first row that needs it (journal mode)
  // or the single customer-mode popup. Used by summary/preview screens that
  // don't have a specific row in context.
  const openBillAllocAny = () => {
    if (isJournalType) {
      if (firstBillAllocRowId) openBillAlloc(firstBillAllocRowId);
    } else {
      openCustomerBillAlloc();
    }
  };

  // Auto-fill "On Account" for non-bill-by-bill rows silently (no popup needed)
  const autoFillOnAccount = (rowId: string, amt: number, dir: 'Dr' | 'Cr') => {
    setJournalRows(p => p.map(r => {
      if (r.id !== rowId) return r;
      const entry = { id: uid(), type: 'On Account' as const, refno: '', amount: amt, direction: dir };
      return { ...r, billAlloc: [entry] };
    }));
  };

  // Non-journal (Sales/Purchase/etc.) single-party bill allocation — unchanged
  // from the original single-party model since customers only have ONE party ledger.
  const openCustomerBillAlloc = async () => {
    const snapGrandTotal = grandTotal;
    const snapPartyDir: 'Dr' | 'Cr' = isPurchaseMode ? 'Cr' : 'Dr';
    if (billAllocEntries.length === 0) {
      setBillAllocEntries([{ id: uid(), type: 'New', refno: voucherNo || '', amount: snapGrandTotal, direction: snapPartyDir }]);
    }
    setBillAllocOpen(true);
    const lookupId = parseInt(partyId, 10);
    if (lookupId) {
      try {
        setPendingRefsDir('Cr');
        const excludeVchId = editVoucherData?.id ? Number(editVoucherData.id) : undefined;
        const res = await vouchersApi.getPendingRefs(lookupId, 'Cr', excludeVchId);
        if (res.success) setPendingRefs(res.data);
      } catch { setPendingRefs([]); }
    }
  };

  const openBillAlloc = async (rowId: string) => {
    const row = journalRows.find(r => r.id === rowId);
    if (!row) return;
    const rowAmount = row.drOrCr === 'Dr' ? row.dr_amount : row.cr_amount;
    const rowDir: 'Dr' | 'Cr' = row.drOrCr;
    setActiveJournalRowId(rowId);
    const existing = row.billAlloc.length > 0
      ? row.billAlloc
      : [{ id: uid(), type: 'New' as const, refno: voucherNo || '', amount: rowAmount, direction: rowDir }];
    setBillAllocEntries(existing);
    setBillAllocOpen(true);
    // For journal mode use this row's own ledger; otherwise use partyId
    const lookupId = isJournalType ? row.ledger_id : parseInt(partyId, 10);
    if (lookupId) {
      try {
        // Direction: Cr row = settling outstanding bills (show positive pending)
        //            Dr row = settling credit notes (show negative pending)
        const direction = isJournalType ? rowDir : 'Cr';
        setPendingRefsDir(direction);
        // When editing, exclude this voucher's own allocations from the netting
        // so the bill it currently settles still appears as pending.
        const excludeVchId = editVoucherData?.id ? Number(editVoucherData.id) : undefined;
        const res = await vouchersApi.getPendingRefs(lookupId, direction, excludeVchId);
        if (res.success) {
          setPendingRefs(res.data);
          // For journal-type vouchers (Receipt/Payment/Journal/Contra), auto-select
          // the best matching pending bill so users don't have to manually switch
          // New→Agr. every time. Only applies to the freshly-created single 'New' entry.
          if (isJournalType && res.data.length > 0) {
            setBillAllocEntries(prev => {
              if (prev.length !== 1 || prev[0].type !== 'New') return prev;
              // Prefer a bill whose amount exactly matches; fall back to the first.
              const exactMatch = res.data.find((p: any) => Math.abs(Number(p.amount) - rowAmount) < 0.01);
              const pick = exactMatch || res.data[0];
              const billDir = pick.direction || (Number(pick.amount) > 0 ? 'Dr' : 'Cr');
              const settleDir: 'Dr' | 'Cr' = billDir === 'Dr' ? 'Cr' : 'Dr';
              const autoAmt = +Math.min(Number(pick.amount), rowAmount).toFixed(2);
              return [{ ...prev[0], type: 'Agr.', refno: pick.billname, refSearch: pick.billname, amount: autoAmt, direction: settleDir }];
            });
          }
        }
      } catch { setPendingRefs([]); }
    }
  };

  const closeBillAlloc = () => { setBillAllocOpen(false); setActiveJournalRowId(null); };

  // Persist the popup's working state back onto the active row's own billAlloc
  // array so each bill-by-bill row keeps independent allocations.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!activeJournalRowId) return;
    setJournalRows(prev => prev.map(r => r.id === activeJournalRowId ? { ...r, billAlloc: billAllocEntries } : r));
  }, [billAllocEntries, activeJournalRowId]);

  // Keep a single 'New' bill alloc entry in sync when the active row's amount changes.
  // This prevents the balance going stale if the user adjusts the amount after
  // bill alloc was auto-populated (only applies to the auto-created New entry).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!activeJournalRow) return;
    setBillAllocEntries(prev => {
      if (prev.length !== 1 || prev[0].type !== 'New') return prev;
      const newAmt = activeRowAmount;
      const newDir = partyDir;
      if (Math.abs((prev[0].amount || 0) - newAmt) < 0.01 && prev[0].direction === newDir) return prev;
      return [{ ...prev[0], amount: newAmt, direction: newDir }];
    });
  }, [activeRowAmount, partyDir, activeJournalRow]);

  // ----- Submit -----
  const handleSubmit = async () => {
    if (isStockJournal) {
      const validSrc  = stockSource.filter(l => l.item_id && l.qty > 0);
      const validDest = stockDest.filter(l => l.item_id && l.qty > 0);
      if (validSrc.length === 0 && validDest.length === 0) {
        showError('Validation', 'Add at least one item in Source or Destination');
        return;
      }
      setSubmitting(true);
      try {
        const vtId = childTypes.find(t => t.name === voucherType)?.id || selectedParentId;
        const payload: any = {
          vch_type_id: vtId,
          vch_no: voucherNo || undefined,
          vch_date: voucherDate || undefined,
          remark: remark.trim() || undefined,
          stock_source: validSrc.map(l => ({ item_id: Number(l.item_id), qty: l.qty, rate: l.rate, amount: l.amount, gst_rate: l.gst_rate, batch_rows: l.batch_rows })),
          stock_destination: validDest.map(l => ({ item_id: Number(l.item_id), qty: l.qty, rate: l.rate, amount: l.amount, gst_rate: l.gst_rate, batch_rows: l.batch_rows })),
        };
        const res = editId ? await vouchersApi.update(editId, payload) : await vouchersApi.create(payload);
        if (res.success) {
          const sjData = (res as any)?.data;
          if (sjData?.vch_no_bumped && sjData?.vch_no) {
            showError('Voucher No. Changed', `Number already taken by another user. Saved as ${sjData.vch_no}`);
          } else {
            showSuccess('Saved', res.message || (editId ? 'Stock Journal updated' : 'Stock Journal created'));
          }
          setStockSource([emptyStockLine()]);
          setStockDest([emptyStockLine()]);
          if (!editId && vtId) {
            const newNo = await vouchersApi.getNextNo(vtId, voucherDate).catch(() => null);
            if (newNo?.success) setVoucherNo(newNo.data ?? '');
          }
        } else showError('Error', res.message || 'Failed to save');
      } catch (e: any) { showError('Error', e?.message || 'Failed'); }
      finally { setSubmitting(false); }
      return;
    }

    if (isJournalType) {
      // Reject any row that has either typed text without a selection OR an
      // amount entered without a ledger picked. Both indicate an incomplete
      // line that must not be saved.
      const orphanText = journalRows.find(r => !r.ledger_id && r.search.trim());
      if (orphanText) {
        showError('Validation', `"${orphanText.search.trim()}" is not a valid ledger. Pick one from the search dropdown.`);
        return;
      }
      const amountWithoutLedger = journalRows.find(r => !r.ledger_id && (r.dr_amount > 0 || r.cr_amount > 0));
      if (amountWithoutLedger) {
        const idx = journalRows.indexOf(amountWithoutLedger) + 1;
        showError('Validation', `Row ${idx}: amount entered but no ledger selected. Pick a ledger from the search dropdown first.`);
        return;
      }
      const validRows = journalRows.filter(r => r.ledger_id && (r.dr_amount > 0 || r.cr_amount > 0));
      if (validRows.length === 0) { showError('Validation', 'Add at least one ledger entry'); return; }
      // If any row has a ledger but no amount → treat as incomplete.
      const blankAmt = journalRows.find(r => r.ledger_id && r.dr_amount === 0 && r.cr_amount === 0);
      if (blankAmt) {
        showError('Validation', `Enter an amount for ${blankAmt.ledger_name || 'the selected ledger'}.`);
        return;
      }
      if (!journalBalanced) { showError('Validation', 'Dr total must equal Cr total'); return; }
      if (journalBillByBill && !allRowsBillAllocBalanced) { showError('Validation', 'Complete bill allocation for every bill-by-bill ledger — each must total its own Dr/Cr amount'); return; }

      // Party-row picker is voucher-type aware:
      //   Receipt  → party (customer)  is on Cr (we receive money from them)
      //   Payment  → party (supplier)  is on Dr (we pay them)
      //   Journal/Contra → either side; fall back to first bill-by-bill row or first Dr row
      // For Receipt/Payment we IGNORE a bill-by-bill row when it sits on the wrong
      // side — that situation arises when the bank ledger also has
      // billbybill='Yes' and the auto-detector fires while the user is filling
      // the bank row. The party MUST be the customer/supplier ledger, so we
      // pick the first row on the correct side regardless of billByBill.
      const parentNameLc = (allVchTypes.find(t => t.id === selectedParentId)?.name || '').toLowerCase();
      const isReceipt = parentNameLc.includes('receipt');
      const isPayment = parentNameLc.includes('payment');
      const defaultPartySide: 'Dr' | 'Cr' = isReceipt ? 'Cr' : 'Dr';
      const billByBillRow = validRows.find(r => r.billByBill) || null;
      const billByBillRowOnRightSide = billByBillRow?.drOrCr === defaultPartySide;
      const useBillByBillRow = billByBillRow && (
        (!isReceipt && !isPayment) || billByBillRowOnRightSide
      );
      const partyRow = useBillByBillRow
        ? (billByBillRow || validRows[0])
        : (validRows.find(r => r.drOrCr === defaultPartySide) || validRows[0]);
      setSubmitting(true);
      try {
        const payload = {
          vch_type_id: (childTypes.find(t => t.name === voucherType)?.id || selectedParentId) || null,
          vch_no:          voucherNo || null,
          vch_date:        voucherDate || null,
          remark:          remark.trim() || null,
          party_ledger_id: partyRow.ledger_id!,
          // When set, backend stamps the voucher with lead_id and auto-closes the lead.
          lead_id:         linkedLeadId || undefined,
          items:           [],
          ledgers: validRows.map(r => ({
            ledger_id: r.ledger_id!,
            amount: r.drOrCr === 'Dr' ? r.dr_amount : -r.cr_amount,
          })),
          bill_allocation: journalBillByBill
            ? validRows.flatMap(r => r.billAlloc.map(e => ({
                type: e.type, refno: e.refno, amount: e.amount, direction: e.direction, ledger_id: r.ledger_id!,
              })))
            : undefined,
        };
        const res = editId
          ? await vouchersApi.update(editId, payload)
          : await vouchersApi.create(payload);
        if (res.success) {
          const wasEdit = !!editId;
          showSuccess('Saved', res.message || (wasEdit ? 'Voucher updated' : 'Voucher created'));
          if (linkedLeadId) {
            showSuccess('Lead Closed', 'Lead has been closed via billing.');
            navigate('/lead/pending');
            return;
          }
          // After updating an existing voucher, return to wherever the user
          // came from (typically Daybook with its date filter preserved in
          // the URL). For brand-new creates, stay on the form to make the
          // common "save then enter another voucher" flow keystroke-light.
          if (wasEdit) {
            if (window.history.length > 1) navigate(-1);
            else navigate('/billing/daybook');
            return;
          }
          setEditId(null);
          setVoucherNo(''); setVoucherDate(new Date().toISOString().slice(0, 10));
          setRemark(''); setBillAllocEntries([]); setCustomerBillByBill(false);
          setJournalRows([emptyJournalRow(), emptyJournalRow()]);
          setActiveJournalRowId(null);
        }
      } catch (e: any) { showError('Error', e.message || 'Failed to save voucher'); }
      finally { setSubmitting(false); }
      return;
    }

    if (!partyId) {
      // Stricter message when the user typed text but never selected from the
      // dropdown — that's the most common cause of an unset partyId.
      if (partyDisplay.trim()) {
        showError('Validation', `"${partyDisplay.trim()}" is not a valid customer. Pick one from the search dropdown (or click + to create a new one).`);
      } else {
        showError('Validation', 'Select a party — field must be green');
      }
      return;
    }
    if (lines.every(l => !l.product_id)) { showError('Validation', 'Add at least one item'); return; }

    // For every batch-tracked item (item.batch === 'Yes'), the line must
    // carry at least one batch row AND every batch row must have a non-empty
    // serial. Without this, clearing the serial in the popup let the user
    // save an item with no traceability — a Tax Invoice for stock that
    // can't be located in any batch.
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.product_id) continue;
      const prod = products.find((p: any) => String(p.id) === String(ln.product_id));
      if (!prod || prod.batch !== 'Yes') continue;
      const rows = ln.batch_rows || [];
      if (rows.length === 0) {
        showError('Validation', `Row ${i + 1}: "${prod.item_name}" requires a serial / batch number — open the batch popup and enter one.`);
        return;
      }
      const blank = rows.findIndex(b => !(b.batch_name || '').trim());
      if (blank !== -1) {
        showError('Validation', `Row ${i + 1}: "${prod.item_name}" — serial / batch number is empty for batch row ${blank + 1}.`);
        return;
      }
    }

    // Reject manual ledger rows where the user typed text but didn't pick
    // a ledger, or entered an amount without a ledger. Same rule as journal-mode.
    const orphanLedger = ledgerRows.find(r => !r.ledger_id && r.search.trim());
    if (orphanLedger) {
      showError('Validation', `"${orphanLedger.search.trim()}" is not a valid ledger. Pick one from the search dropdown.`);
      return;
    }
    const amtWithoutLedger = ledgerRows.find(r => !r.ledger_id && r.amount > 0);
    if (amtWithoutLedger) {
      showError('Validation', 'Ledger row: amount entered but no ledger selected. Pick a ledger from the search dropdown first.');
      return;
    }

    if (!isJournalType && !billAllocBalanced) { showError('Validation', 'Complete bill allocation — balance must reach zero'); return; }

    // Filter ledger rows: only non-zero amounts with a ledger selected.
    const validLedgers = ledgerRows
      .filter(r => r.ledger_id && r.amount !== 0)
      .map(r => ({
        ledger_id: r.ledger_id!,
        amount: r.amount,
      }));


    setSubmitting(true);
    try {
      const payload = {
        vch_type_id: (childTypes.find(t => t.name === voucherType)?.id || selectedParentId) || null,
        vch_no:          voucherNo || null,
        vch_date:        voucherDate || null,
        remark:          remark.trim() || null,
        party_ledger_id: parseInt(partyId, 10),
        is_igst:         isIgst,
        // When set, backend stamps the voucher with lead_id and auto-closes the lead.
        lead_id:         linkedLeadId || undefined,
        items: lines.filter(l => l.product_id).map(l => ({
          item_id:     Number(l.product_id),
          qty:         l.qty,
          rate:        l.rate,
          amount:      l.amount,
          cgst_amount: l.cgst_amount,
          sgst_amount: l.sgst_amount,
          igst_amount: l.igst_amount,
          batch_rows:  l.batch_rows?.length
            ? l.batch_rows.map(b => ({ batch_name: b.batch_name || null, qty: b.qty, rate: b.rate, amount: b.amount }))
            : null,
        })),
        ledgers: validLedgers,
        bill_allocation: customerBillByBill ? billAllocEntries.map(e => ({ type: e.type, refno: e.refno, amount: e.amount, direction: e.direction })) : undefined,
      };

      const res = editId
        ? await vouchersApi.update(editId, payload)
        : await vouchersApi.create(payload);
      if (res.success) {
        // Link any cloud_activities the user picked to this voucher.
        // We pass voucher_id (FK) so the linkage survives a future vch_no
        // rename — the activities listing JOINs back to vch_details to
        // surface the live number. voucher_no is also sent as a cache hint.
        const savedVoucherId =
          (res as any)?.data?.id ??
          (typeof editId === 'number' ? editId : undefined);
        if (activitiesToLink.length && (savedVoucherId || voucherNo)) {
          try {
            await activitiesApi.markBilled(activitiesToLink, {
              voucherId: savedVoucherId,
              voucherNo: voucherNo || undefined,
            });
          } catch (e: any) {
            showError('Warning', e.message || 'Voucher saved, but failed to link cloud activities. Update them manually.');
          }
        }
        const wasEdit = !!editId;
        const savedData = (res as any)?.data;
        if (savedData?.vch_no_bumped && savedData?.vch_no) {
          showError('Voucher No. Changed', `Number already taken by another user. Saved as ${savedData.vch_no}`);
        } else {
          showSuccess('Saved', res.message || (wasEdit ? 'Voucher updated' : 'Voucher created'));
        }
        if (linkedLeadId) {
          showSuccess('Lead Closed', 'Lead has been closed via billing.');
          navigate('/lead/pending');
          return;
        }
        // After updating an existing voucher, return to wherever the user
        // came from (typically Daybook with its date filter preserved in
        // the URL). New creates stay on the form for fast successive entry.
        if (wasEdit) {
          if (window.history.length > 1) navigate(-1);
          else navigate('/billing/daybook');
          return;
        }
        setEditId(null);
        setLines([emptyLine()]); setVoucherNo('');
        setVoucherDate(new Date().toISOString().slice(0, 10));
        setPartyDisplay(''); setPartyId(''); setPartyState(''); setIsIgst(false);
        setLedgerRows([]); setRemark('');
        setCustomers([]); setBillAllocEntries([]); setCustomerBillByBill(false);
        setActivitiesToLink([]);
        // Re-fetch next auto number for the next voucher
        const vtId = childTypes.find(t => t.name === voucherType)?.id || selectedParentId;
        if (vtId) {
          vouchersApi.getNextNo(vtId, voucherDate).then((r: any) => { if (r?.success) setVoucherNo(r.data ?? ''); }).catch(() => {});
        }
      }
    } catch (e: any) { showError('Error', e.message || 'Failed to save voucher'); }
    finally { setSubmitting(false); }
  };
  // Keep the ref in sync so the global keyboard shortcut (Alt+S) always
  // calls the latest version of handleSubmit.
  handleSubmitRef.current = handleSubmit;

  // fmt is defined at module level

  // Sundry Debtors (party customers) shouldn't appear in the items-mode
  // Add Ledger dropdown — they belong in the Customer Name field at the
  // top, not as contra ledgers on the same voucher. Hide them here.
  const ledgerOptions = (search: string) =>
    allLedgers
      .filter(l => l.ledgergroup !== SUNDRY_DEBTORS_ID)
      .filter(l => (l.company || '').toLowerCase().includes(search.toLowerCase()))
      .slice(0, 20);

  // CGST/SGST/IGST are auto-posted from item tax rates on Sales/Purchase/
  // Tax Invoice vouchers — they don't apply to Journal/Payment/Receipt/
  // Contra, so hide them from the ledger search on those voucher types.
  const TAX_LEDGER_NAMES = ['cgst', 'sgst', 'igst'];
  const filterJournalLedgers = (list: any[]) =>
    list.filter(l => !TAX_LEDGER_NAMES.includes((l.company || '').trim().toLowerCase()));

  const mobileParentColor = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('sales'))    return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    if (n.includes('purchase')) return 'border-blue-300 bg-blue-50 text-blue-700';
    if (n.includes('receipt'))  return 'border-green-300 bg-green-50 text-green-700';
    if (n.includes('payment'))  return 'border-orange-300 bg-orange-50 text-orange-700';
    if (n.includes('journal'))  return 'border-purple-300 bg-purple-50 text-purple-700';
    if (n.includes('contra'))   return 'border-slate-300 bg-slate-50 text-slate-700';
    if (n.includes('credit'))   return 'border-teal-300 bg-teal-50 text-teal-700';
    if (n.includes('debit'))    return 'border-red-300 bg-red-50 text-red-700';
    return 'border-gray-200 bg-white text-gray-700';
  };

  return (
    <>
      <div className="print:hidden">
    {/* ── Mobile Wizard (small screens only) ── */}
    <div className="block md:hidden min-h-screen bg-gray-50 pb-24">
      {readOnly && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm text-center py-1.5 px-4">
          {checkedLockActive
            ? <><strong>Checked & Locked</strong> — only an admin can edit.</>
            : <><strong>View Only</strong> — no edit permission.</>}
        </div>
      )}
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button type="button"
          onClick={() => {
            if (mobileStep === 1) { if (window.history.length > 1) navigate(-1); else navigate('/billing/daybook'); }
            else setMobileStep(s => s - 1);
          }}
          className="p-1 text-gray-500 -ml-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-gray-400 leading-none">
            {['Select Type', 'Vch Details', 'Line Details', 'Preview & Save'][mobileStep - 1]}
          </p>
          <p className="text-sm font-semibold text-gray-800 leading-tight truncate">
            {selectedParentId ? (allVchTypes.find(t => t.id === selectedParentId)?.name || 'Voucher') : 'New Voucher'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className={`w-2 h-2 rounded-full transition-colors ${mobileStep >= s ? 'bg-blue-600' : 'bg-gray-300'}`} />
          ))}
        </div>
      </div>

      {/* Step 1: VCH type selection */}
      {mobileStep === 1 && (
        <div className="p-4">
          <p className="text-sm text-gray-500 mb-4">Select the voucher type to create:</p>
          <div className="grid grid-cols-2 gap-3">
            {systemParents.map(p => (
              <button key={p.id} type="button"
                onClick={() => { setSelectedParentId(p.id); setMobileStep(2); }}
                className={`border-2 rounded-xl py-6 px-3 text-center font-semibold text-sm transition-all active:scale-95 ${
                  selectedParentId === p.id
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : mobileParentColor(p.name)
                }`}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Voucher Details */}
      {mobileStep === 2 && (
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Voucher Type</label>
            <select value={voucherType} onChange={e => setVoucherType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg text-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white">
              {childTypes.length === 0 ? (
                voucherType
                  ? <option value={voucherType}>{voucherType}</option>
                  : <option value="">-- No types --</option>
              ) : (
                childTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Voucher No</label>
            <input type="text" value={voucherNo} onChange={e => setVoucherNo(e.target.value)}
              placeholder="e.g. S-001"
              className="w-full border border-gray-300 rounded-lg text-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Voucher Date</label>
            <input type="date" value={voucherDate} onChange={e => setVoucherDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg text-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {!isJournalType && (
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1.5">Customer</label>
              <input type="text"
                value={customerSearch !== '' ? customerSearch : partyDisplay}
                onChange={e => {
                  setCustomerSearch(e.target.value);
                  if (!e.target.value) { setPartyId(''); setPartyDisplay(''); }
                  setShowCustomerDrop(true);
                }}
                onFocus={() => { if (customers.length > 0) setShowCustomerDrop(true); }}
                onBlur={() => setTimeout(() => setShowCustomerDrop(false), 300)}
                placeholder="Search customer..."
                className="w-full border border-gray-300 rounded-lg text-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              {showCustomerDrop && customers.length > 0 && (
                <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-52 overflow-y-auto">
                  {customers.map((c: any) => (
                    <div key={c.id} onPointerDown={() => selectParty(c)}
                      className="px-3 py-2.5 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                      <div className="font-medium text-gray-800">{c.company}</div>
                      {c.mobile && <div className="text-xs text-gray-400">{c.mobile}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={() => setMobileStep(3)}
            className="w-full bg-blue-600 text-white text-sm font-semibold py-3 rounded-xl mt-2">
            Next: Line Details →
          </button>
        </div>
      )}

      {/* Step 3: Line Details */}
      {mobileStep === 3 && (
        <div className="p-4">
          {isJournalType ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">Dr / Cr Entries</p>
                {!journalBalanced && journalRows.some(r => r.ledger_id) && (
                  <span className="text-xs text-red-500">Dr {fmt(journalDrTotal)} ≠ Cr {fmt(journalCrTotal)}</span>
                )}
              </div>
              {journalRows.map((row, idx) => (
                <div key={row.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {/* Row 1: Ledger search */}
                  <div className="relative px-3 pt-2.5 pb-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] text-gray-400 font-medium">{idx + 1}</span>
                      {journalRows.length > 1 && (
                        <button type="button" onClick={() => setJournalRows(p => p.filter(r => r.id !== row.id))}
                          className="ml-auto text-red-400 p-0.5"><X size={13} /></button>
                      )}
                    </div>
                    <input type="text" value={row.search}
                      onChange={e => {
                        const q = e.target.value;
                        setJournalRows(p => p.map(r => r.id === row.id ? { ...r, search: q, ledger_id: null, ledger_name: '', open: q.length >= 2 } : r));
                        if (q.length >= 2) {
                          customersApi.searchAllLedgers(q).then((res: any) => {
                            const list = filterJournalLedgers(res?.data || []);
                            setJournalRows(p => p.map(r => r.id === row.id ? { ...r, results: list, open: true } : r));
                          }).catch(() => {});
                        }
                      }}
                      onBlur={() => setTimeout(() => setJournalRows(p => p.map(r => r.id === row.id ? { ...r, open: false } : r)), 300)}
                      placeholder="Search ledger..."
                      className={`w-full border rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 ${
                        row.ledger_id ? 'border-green-400 bg-green-50 focus:ring-green-300'
                          : row.search.trim() ? 'border-red-300 focus:ring-red-300'
                          : 'border-gray-300 focus:ring-blue-400'
                      }`} />
                    {row.open && row.results.length > 0 && (
                      <div className="absolute z-30 left-3 right-3 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-48 overflow-y-auto">
                        {row.results.map((l: any) => (
                          <div key={l.id} onPointerDown={() => {
                            const isBillByBill = l.billbybill === 'Yes';
                            setJournalRows(p => p.map(r => r.id === row.id
                              ? { ...r, ledger_id: l.id, ledger_name: l.company, search: l.company, open: false, billByBill: isBillByBill, billAlloc: isBillByBill ? r.billAlloc : [] }
                              : r));
                          }}
                            className="px-3 py-2.5 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                            {l.company}
                            {l.billbybill === 'Yes' && <span className="ml-1 text-[10px] text-blue-400">bill-by-bill</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Row 2: Dr/Cr toggle + Amount on same line */}
                  <div className="flex items-center gap-0 border-t border-gray-100">
                    <div className="flex border-r border-gray-100">
                      <button type="button"
                        onClick={() => setJournalRows(p => p.map(r => r.id === row.id ? { ...r, drOrCr: 'Dr', cr_amount: 0 } : r))}
                        className={`px-4 py-2.5 text-sm font-bold transition-colors ${row.drOrCr === 'Dr' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>Dr</button>
                      <button type="button"
                        onClick={() => setJournalRows(p => p.map(r => r.id === row.id ? { ...r, drOrCr: 'Cr', dr_amount: 0 } : r))}
                        className={`px-4 py-2.5 text-sm font-bold transition-colors ${row.drOrCr === 'Cr' ? 'bg-orange-500 text-white' : 'bg-white text-gray-500'}`}>Cr</button>
                    </div>
                    <input type="number" inputMode="decimal"
                      value={row.drOrCr === 'Dr' ? (row.dr_amount || '') : (row.cr_amount || '')}
                      onChange={e => {
                        const amt = parseFloat(e.target.value) || 0;
                        setJournalRows(p => p.map(r => r.id === row.id
                          ? { ...r, dr_amount: r.drOrCr === 'Dr' ? amt : 0, cr_amount: r.drOrCr === 'Cr' ? amt : 0 }
                          : r));
                      }}
                      onBlur={e => {
                        if (isJournalType) {
                          const rowAmt = parseFloat(e.target.value) || 0;
                          const rowSigned = row.drOrCr === 'Dr' ? rowAmt : -rowAmt;
                          const allocSigned = row.billAlloc.reduce((s, en) => s + (en.direction === 'Cr' ? -(Number(en.amount) || 0) : (Number(en.amount) || 0)), 0);
                          if (rowAmt > 0 && (row.billAlloc.length === 0 || Math.abs(rowSigned - allocSigned) >= 0.01)) {
                            if (row.billByBill) setTimeout(() => openBillAlloc(row.id), 50);
                            else autoFillOnAccount(row.id, rowAmt, row.drOrCr);
                          }
                        }
                      }}
                      placeholder="Amount"
                      className="flex-1 text-sm py-2.5 px-3 text-right focus:outline-none bg-transparent font-semibold text-gray-800 placeholder-gray-300" />
                  </div>
                  {/* Bill allocation status bar — only for bill-by-bill rows */}
                  {row.billByBill && (row.drOrCr === 'Dr' ? row.dr_amount : row.cr_amount) > 0 && (() => {
                    const rowAmt = row.drOrCr === 'Dr' ? row.dr_amount : row.cr_amount;
                    const rowSigned = row.drOrCr === 'Dr' ? rowAmt : -rowAmt;
                    const allocSigned = row.billAlloc.reduce((s, en) => s + (en.direction === 'Cr' ? -(Number(en.amount) || 0) : (Number(en.amount) || 0)), 0);
                    const rowBalanced = Math.abs(rowSigned - allocSigned) < 0.01;
                    return (
                      <button type="button" onClick={() => openBillAlloc(row.id)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 border-t text-xs font-semibold transition-colors ${
                          rowBalanced
                            ? 'border-green-100 bg-green-50 text-green-600'
                            : 'border-orange-200 bg-orange-50 text-orange-600 animate-pulse'
                        }`}>
                        <span>{rowBalanced ? '✓ Bill allocation done' : '⚠ Bill allocation required'}</span>
                        <span className="underline">{rowBalanced ? 'Edit' : 'Tap to Allocate'}</span>
                      </button>
                    );
                  })()}
                </div>
              ))}
              <button type="button" onClick={() => setJournalRows(p => [...p, emptyJournalRow()])}
                className="flex items-center gap-1.5 text-sm text-green-600 py-2 mt-1">
                <Plus size={16} /> Add Row
              </button>
              <div className="flex justify-between text-sm font-medium pt-2 border-t border-gray-200 mt-2">
                <span className="text-blue-600">Dr: {fmt(journalDrTotal)}</span>
                <span className="text-orange-600">Cr: {fmt(journalCrTotal)}</span>
              </div>
              {/* Remark — journal mode */}
              {remark ? (
                <div className="mt-3 bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-2">
                  <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2}
                    placeholder="Optional note..."
                    className="flex-1 text-sm text-gray-700 bg-transparent border-none outline-none resize-none" />
                  <button type="button" onClick={() => setRemark('')} className="text-gray-300 hover:text-gray-500 mt-0.5"><X size={14} /></button>
                </div>
              ) : (
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => setRemark(' ')}
                    className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5 shadow-sm">
                    <Plus size={14} /> Add Remark
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* ── Item cards ── */}
              <div className="space-y-2 mb-2">
                {lines.map((line, idx) => (
                  <div key={idx} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    {/* Item name row */}
                    <div className="flex items-center gap-1 px-3 py-3 border-b border-gray-100">
                      <span className="text-[10px] text-gray-400 w-4 flex-shrink-0">{idx + 1}</span>
                      <div className="relative flex-1">
                        <input type="text"
                          value={line.item_search ?? line.item_name}
                          onChange={e => {
                            const q = e.target.value;
                            setLines(p => p.map((l, i) => i !== idx ? l : { ...l, item_search: q, item_name: '', product_id: '', item_open: q.length >= 1 }));
                          }}
                          onBlur={() => setTimeout(() => setLines(p => p.map((l, i) => i !== idx ? l : { ...l, item_open: false })), 300)}
                          placeholder="Tap to search item..."
                          className="w-full text-sm font-semibold text-gray-800 placeholder-gray-400 bg-transparent border-none outline-none" />
                        {line.item_open && products.filter((p: any) => !(line.item_search) || (p.item_name || '').toLowerCase().includes((line.item_search || '').toLowerCase())).length > 0 && (
                          <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-44 overflow-y-auto">
                            {products.filter((p: any) => !(line.item_search) || (p.item_name || '').toLowerCase().includes((line.item_search || '').toLowerCase())).slice(0, 20).map((p: any) => (
                              <div key={p.id} onPointerDown={() => {
                                setLines(prev => prev.map((l, i) => i !== idx ? l : calcLine({
                                  ...l, product_id: String(p.id), item_name: p.item_name,
                                  item_search: p.item_name, item_open: false, gst_rate: Number(p.gst) || 0,
                                }, isIgst)));
                                if (p.batch === 'Yes') setTimeout(() => openBatchPopup(idx, String(p.id)), 0);
                                else if (p.category_id === CLOUD_CATEGORY_ID) setTimeout(() => openCloudPopup(idx), 0);
                              }} className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                                <div className="font-medium">{p.item_name}</div>
                                {p.sale_price != null && <div className="text-xs text-gray-400">₹{p.sale_price}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))}
                          className="text-red-400 p-2 flex-shrink-0"><X size={14} /></button>
                      )}
                    </div>
                    {(() => {
                      const prod = products.find((p: any) => String(p.id) === String(line.product_id));
                      const named = (line.batch_rows || []).filter(b => (b.batch_name || '').trim()).length;
                      if (prod?.batch !== 'Yes' && named === 0) return null;
                      return (
                        <div className="px-3 pb-1 -mt-1">
                          <button type="button" onClick={() => openBatchPopup(idx)}
                            className={`text-[11px] hover:underline ${named > 0 ? 'text-blue-500' : 'text-orange-500'}`}>
                            {named > 0 ? `${named} serial(s) — edit` : 'Add batch / serial details'}
                          </button>
                        </div>
                      );
                    })()}
                    {/* Qty | Rate | Amount — single-line label:value in bordered box */}
                    <div className="grid grid-cols-3 gap-2 px-3 py-2.5">
                      <label className="flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-2.5 bg-gray-50 cursor-text">
                        <span className="text-[9px] text-gray-400 uppercase tracking-wide shrink-0">Qty</span>
                        <span className="text-[9px] text-gray-300 shrink-0">:</span>
                        <input type="number" inputMode="decimal" value={line.qty || ''}
                          onChange={e => { const qty = parseFloat(e.target.value) || 0; setLines(p => p.map((l, i) => i !== idx ? l : calcLine({ ...l, qty }, isIgst))); }}
                          className="w-full min-w-0 text-sm font-semibold text-gray-800 bg-transparent border-none outline-none text-right" />
                      </label>
                      <label className="flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-2.5 bg-gray-50 cursor-text">
                        <span className="text-[9px] text-gray-400 uppercase tracking-wide shrink-0">Rate</span>
                        <span className="text-[9px] text-gray-300 shrink-0">:</span>
                        <input type="number" inputMode="decimal" value={line.rate || ''}
                          onChange={e => { const rate = parseFloat(e.target.value) || 0; setLines(p => p.map((l, i) => i !== idx ? l : calcLine({ ...l, rate }, isIgst))); }}
                          className="w-full min-w-0 text-sm font-semibold text-gray-800 bg-transparent border-none outline-none text-right" />
                      </label>
                      <label className="flex items-center gap-1 border border-blue-200 rounded-lg px-2.5 py-2.5 bg-blue-50 cursor-text">
                        <span className="text-[9px] text-blue-400 uppercase tracking-wide shrink-0">Amt</span>
                        <span className="text-[9px] text-blue-300 shrink-0">:</span>
                        <input type="number" inputMode="decimal" value={line.amount || ''}
                          onChange={e => { const amt = parseFloat(e.target.value) || 0; setLines(p => p.map((l, i) => i !== idx ? l : calcLineFromAmount({ ...l }, isIgst, amt))); }}
                          className="w-full min-w-0 text-sm font-bold text-blue-700 bg-transparent border-none outline-none text-right" />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              {/* + Add Item */}
              <button type="button" onClick={() => setLines(p => [...p, emptyLine()])}
                className="flex items-center gap-1.5 text-sm text-green-600 py-2 px-1 mb-3">
                <Plus size={16} /> Add Item
              </button>

              {/* Summary section */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Item Total */}
                <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                  <span className="text-sm text-gray-500">Item Total</span>
                  <span className="text-sm font-semibold text-gray-800">₹{fmt(subtotal)}</span>
                </div>

                {/* Auto ledger rows (CGST / SGST / IGST) — flat rows */}
                {ledgerRows.filter(r => r.auto).map(row => (
                  <div key={row.id} className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                    <span className="text-sm text-gray-600">{row.ledger_name}</span>
                    <span className="text-sm font-medium text-gray-800">₹{fmt(row.amount)}</span>
                  </div>
                ))}

                {/* Manual ledger rows — editable */}
                {ledgerRows.filter(r => !r.auto).map(row => (
                  <div key={row.id} className="border-b border-gray-100">
                    <div className="flex items-center gap-2 px-4 py-2">
                      <div className="flex-1">
                        <input type="text" value={row.search}
                          onChange={e => updateLedgerRow(row.id, { search: e.target.value, ledger_id: null, ledger_name: '', open: e.target.value.length >= 1 })}
                          onBlur={() => setTimeout(() => updateLedgerRow(row.id, { open: false }), 300)}
                          placeholder="Search ledger..."
                          className="w-full text-sm text-gray-800 border-none outline-none bg-transparent placeholder-gray-400" />
                        {row.open && ledgerOptions(row.search).length > 0 && (
                          <div className="bg-white border border-gray-200 rounded-lg shadow-md mt-1 max-h-36 overflow-y-auto">
                            {ledgerOptions(row.search).map(l => (
                              <div key={l.id} onPointerDown={() => selectLedger(row.id, l)}
                                className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">{l.company}</div>
                            ))}
                          </div>
                        )}
                      </div>
                      <input type="number" inputMode="decimal" value={row.amount || ''}
                        onChange={e => updateLedgerRow(row.id, { amount: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00"
                        className="w-24 text-sm font-medium text-gray-800 text-right border-none outline-none bg-transparent" />
                      <button type="button" onClick={() => removeLedgerRow(row.id)} className="text-red-400 p-0.5"><X size={14} /></button>
                    </div>
                  </div>
                ))}

                {/* + Add Ledger */}
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <button type="button" onClick={addLedgerRow}
                    className="flex items-center gap-1.5 text-sm text-blue-500">
                    <Plus size={15} /> Add Ledger
                  </button>
                </div>

                {/* Grand Total */}
                <div className="flex justify-between items-center px-4 py-3.5">
                  <span className="text-base font-bold text-gray-900">Grand Total</span>
                  <span className="text-lg font-bold text-blue-600">₹{fmt(grandTotal)}</span>
                </div>
              </div>

              {/* Remark — collapsible */}
              {remark ? (
                <div className="mt-3 bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-2">
                  <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2}
                    placeholder="Optional note..."
                    className="flex-1 text-sm text-gray-700 bg-transparent border-none outline-none resize-none" />
                  <button type="button" onClick={() => setRemark('')} className="text-gray-300 hover:text-gray-500 mt-0.5"><X size={14} /></button>
                </div>
              ) : (
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => setRemark(' ')}
                    className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1.5 shadow-sm">
                    <Plus size={14} /> Add Remark
                  </button>
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={() => {
            if (journalBillByBill && !allRowsBillAllocBalanced) { openBillAllocAny(); return; }
            setMobileStep(4);
          }}
            className={`w-full text-white text-sm font-semibold py-3.5 rounded-xl mt-4 ${
              journalBillByBill && !allRowsBillAllocBalanced ? 'bg-orange-500' : 'bg-blue-600'
            }`}>
            {journalBillByBill && !allRowsBillAllocBalanced ? '⚠ Complete Bill Allocation First' : 'Next: Preview →'}
          </button>
        </div>
      )}

      {/* Step 4: Preview & Save */}
      {mobileStep === 4 && (
        <div className="p-4 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            <div className="px-4 py-3 flex justify-between items-center text-sm">
              <span className="text-gray-500">Type</span>
              <span className="font-medium text-gray-800">{voucherType || allVchTypes.find(t => t.id === selectedParentId)?.name || '—'}</span>
            </div>
            <div className="px-4 py-3 flex justify-between items-center text-sm">
              <span className="text-gray-500">Vch No</span>
              <span className="font-medium text-gray-800">{voucherNo || '—'}</span>
            </div>
            <div className="px-4 py-3 flex justify-between items-center text-sm">
              <span className="text-gray-500">Date</span>
              <span className="font-medium text-gray-800">
                {voucherDate ? new Date(voucherDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
              </span>
            </div>
            {!isJournalType && partyDisplay && (
              <div className="px-4 py-3 flex justify-between items-center text-sm">
                <span className="text-gray-500">Customer</span>
                <span className="font-medium text-gray-800 text-right max-w-[60%] truncate">{partyDisplay}</span>
              </div>
            )}
            {!isJournalType && lines.some(l => l.item_name) && (
              <div className="px-4 py-3">
                <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">Items</p>
                <div className="space-y-1">
                  {lines.filter(l => l.item_name).map((l, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-700">{l.item_name} × {l.qty}</span>
                      <span className="text-gray-800 font-medium">₹{fmt(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isJournalType && journalRows.some(r => r.ledger_id) && (
              <div className="px-4 py-3">
                <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">Entries</p>
                <div className="space-y-1">
                  {journalRows.filter(r => r.ledger_id).map((r, i) => (
                    <div key={i} className="flex justify-between items-center text-sm">
                      <span className="text-gray-700">{r.ledger_name}</span>
                      <span className="flex items-center gap-2">
                        {r.billByBill && (
                          <button type="button" onClick={() => openBillAlloc(r.id)}
                            className={`text-[11px] font-semibold underline decoration-dotted ${isRowBillAllocBalanced(r) ? 'text-green-600' : 'text-orange-500'}`}>
                            {isRowBillAllocBalanced(r) ? '✓ Bills' : 'Allocate'}
                          </button>
                        )}
                        <span className={`font-medium ${r.drOrCr === 'Dr' ? 'text-blue-600' : 'text-orange-600'}`}>
                          {r.drOrCr} ₹{fmt(r.drOrCr === 'Dr' ? r.dr_amount : r.cr_amount)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="px-4 py-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-800">Grand Total</span>
              <span className="text-lg font-bold text-blue-600">
                ₹{fmt(isJournalType ? journalDrTotal : grandTotal)}
              </span>
            </div>
            {/* Bill Allocation row — non-journal (single party) only; journal rows show inline above */}
            {customerBillByBill && (
              <div className="px-4 py-3 flex justify-between items-center">
                <span className="text-sm text-gray-600">Bill Allocation</span>
                <button type="button" onClick={openCustomerBillAlloc}
                  className={`text-sm font-semibold underline decoration-dotted ${billAllocBalanced ? 'text-green-600' : 'text-orange-500'}`}>
                  {billAllocBalanced
                    ? `✓ ₹${fmt(billAllocTotal)}`
                    : `₹${fmt(billAllocTotal)} / ₹${fmt(effectiveGrandTotal)} — tap to fix`}
                </button>
              </div>
            )}
            {remark && (
              <div className="px-4 py-3">
                <p className="text-[11px] text-gray-400">Remark</p>
                <p className="text-sm text-gray-700 mt-0.5">{remark}</p>
              </div>
            )}
          </div>
          {/* Bill Allocation warning if not balanced */}
          {customerBillByBill && !billAllocBalanced && (
            <button type="button" onClick={openCustomerBillAlloc}
              className="w-full bg-orange-50 border border-orange-200 text-orange-700 text-sm font-medium py-3 rounded-xl flex items-center justify-center gap-2">
              ⚠ Complete Bill Allocation — Balance ₹{fmt(Math.abs(billAllocBalance))} remaining
            </button>
          )}
          {journalBillByBill && !allRowsBillAllocBalanced && (
            <button type="button" onClick={openBillAllocAny}
              className="w-full bg-orange-50 border border-orange-200 text-orange-700 text-sm font-medium py-3 rounded-xl flex items-center justify-center gap-2">
              ⚠ Complete Bill Allocation for all ledgers
            </button>
          )}
          {isSalesType && partyId && lines.some(l => l.product_id) && editId && (
            <div className="flex gap-2 mb-2">
              <button type="button"
                onClick={() => navigate(`/billing/print-voucher/${editId}`)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-base font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors">
                <Printer size={18} /> Print
              </button>
              <button type="button"
                onClick={() => handleDirectDownload(editId!)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors">
                <Download size={18} /> Download
              </button>
            </div>
          )}
          <button type="button"
            onClick={handleSubmit}
            disabled={submitting || readOnly}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-base font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors">
            <Save size={18} />
            {submitting ? 'Saving...' : editId ? 'Update Voucher' : 'Save Voucher'}
          </button>
        </div>
      )}
    </div>

    {/* ── Desktop layout (md and above) ── */}
    <div className="hidden md:flex min-h-screen bg-gray-50 p-3 gap-3 items-start">
      {readOnly && (
        <div className="fixed top-14 md:top-16 left-0 right-0 z-30 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm text-center py-1.5 px-4">
          {checkedLockActive ? (
            <><strong>Checked & Locked</strong> — marked Checked by <strong>{checkedBy}</strong>{checkedAt ? ` on ${new Date(checkedAt).toLocaleString('en-IN')}` : ''}. Only an admin can edit.</>
          ) : (
            <><strong>View Only</strong> — you don't have permission to edit vouchers.</>
          )}
        </div>
      )}
      {/* ── Right Sidebar: System (parent) Vch Types ── */}
      <div className="w-[140px] flex-shrink-0 bg-white rounded-lg shadow p-3 order-last">
        <p className="text-[10px] uppercase font-semibold text-gray-400 mb-2 tracking-wide">Vch Types</p>
        <div className="flex flex-col gap-1">
          {systemParents.map(p => (
            <button key={p.id} onClick={() => setSelectedParentId(p.id)}
              className={`w-full text-left text-sm px-2.5 py-1.5 rounded transition-colors ${
                selectedParentId === p.id
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-gray-700 hover:bg-blue-50'
              }`}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Form ── */}
      <fieldset ref={formRef} disabled={readOnly} className="bg-white rounded-lg shadow p-4 flex-1 min-w-0 disabled:opacity-95">
        <div className="flex items-center gap-2 mb-4">
          {/* Back returns to the previous page (e.g. Daybook with its date
              filter still in the URL). When opened directly via deep link
              with no history, fall back to the Daybook landing. */}
          <button type="button"
            onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/billing/daybook'); }}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-2 py-1 hover:bg-gray-50"
            title="Back">
            <ArrowLeft size={14} /> Back
          </button>
          <h1 className="text-lg font-semibold text-gray-800">
            Vouchers {readOnly && <span className="text-sm text-amber-700 font-normal ml-2">(Read Only)</span>}
          </h1>

          {/* Mark Checked / Unmark.
              - Mark: any user with edit access (broad — this is the routine
                reviewer action triggered from Pending Review).
              - Unmark: admin only (preserves the audit trail).
              - Checked badge: shown to everyone when the voucher is checked,
                so non-admins can see the status without being able to revert. */}
          {editId && (
            checkedBy ? (() => {
              // Format the timestamp inline: "07-May-2026 02:30 PM" — concise
              // but unambiguous (full year + 12h time).
              const checkedAtFmt = checkedAt
                ? new Date(checkedAt).toLocaleString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true,
                  })
                : null;
              return canUnmarkAsChecked ? (
                <button type="button"
                  onClick={() => setCheckConfirm('unmark')}
                  title={checkedAtFmt ? `Checked on ${checkedAtFmt} — click to unmark` : 'Click to unmark'}
                  className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100 rounded px-2.5 py-1">
                  <span>✓ Checked by <strong>{checkedBy}</strong></span>
                  {checkedAtFmt && <span className="text-[10px] text-amber-600/80 tabular-nums">{checkedAtFmt}</span>}
                  <span className="text-amber-600/70">· click to unmark</span>
                </button>
              ) : (
                <span title={checkedAtFmt ? `Checked on ${checkedAtFmt}` : 'Only admin can unmark'}
                  className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 rounded px-2.5 py-1">
                  <span>✓ Checked by <strong>{checkedBy}</strong></span>
                  {checkedAtFmt && <span className="text-[10px] text-emerald-600/80 tabular-nums">{checkedAtFmt}</span>}
                </span>
              );
            })() : (
              canMarkAsChecked && (
                <button type="button"
                  onClick={() => setCheckConfirm('mark')}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-700 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 rounded px-2.5 py-1">
                  Mark as Checked
                </button>
              )
            )
          )}

          {/* Delete — hidden once the voucher is marked Checked. To delete a
              checked voucher, an admin must first unmark it (the Checked
              flag acts as an audit lock against accidental removal of an
              already-reviewed entry). Also hidden in read-only mode. */}
          {editId && !readOnly && !checkedBy && (canDelete('vouchers') || canDelete('activities')) && (
            <button type="button"
              onClick={() => setDeleteOpen(true)}
              className={`${canMarkAsChecked ? 'ml-2' : 'ml-auto'} inline-flex items-center gap-1 text-xs font-medium text-red-700 border border-red-300 bg-red-50 hover:bg-red-100 rounded px-2.5 py-1`}
              title="Delete voucher">
              <Trash2 size={12} /> Delete
            </button>
          )}

          {isSalesType && partyId && lines.some(l => l.product_id) && editId && (<>
            <button type="button"
              onClick={() => navigate(`/billing/print-voucher/${editId}`)}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 border border-blue-300 bg-blue-50 hover:bg-blue-100 rounded px-2.5 py-1 ml-2"
              title="Print Voucher">
              <Printer size={12} /> Print
            </button>
            <button type="button"
              onClick={() => handleDirectDownload(editId!)}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 rounded px-2.5 py-1 ml-1"
              title="Download PDF">
              <Download size={12} /> Download
            </button>
          </>)}
        </div>

        {/* Mark / Unmark Checked confirm modal — replaces the native
            window.confirm() so the prompt matches the rest of the app's
            chrome. Single modal handles both flows; copy + button label
            change based on `checkConfirm` mode. */}
        {checkConfirm && editId && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
              <h3 className="font-semibold text-gray-800 mb-2">
                {checkConfirm === 'mark' ? 'Mark Voucher as Checked' : 'Remove Checked Flag'}
              </h3>
              <p className="text-sm text-gray-600 mb-5">
                {checkConfirm === 'mark' ? (
                  <>Mark this voucher as <span className="font-semibold text-emerald-700">Checked</span>? Once marked, the voucher is locked — <span className="font-semibold">only an admin can unmark or delete it</span>.</>
                ) : (
                  <>Remove the Checked flag from this voucher? It will become <span className="font-semibold">editable and deletable</span> again by anyone with the appropriate permission.</>
                )}
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCheckConfirm(null)}
                  className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" disabled={checkBusy}
                  onClick={async () => {
                    setCheckBusy(true);
                    try {
                      if (checkConfirm === 'mark') {
                        await vouchersApi.markChecked(editId);
                        setCheckedBy(user?.name || 'me'); setCheckedAt(new Date().toISOString());
                        showSuccess('Marked', 'Voucher marked as Checked');
                      } else {
                        await vouchersApi.markUnchecked(editId);
                        setCheckedBy(null); setCheckedAt(null);
                        showSuccess('Unchecked', 'Voucher is no longer marked as Checked');
                      }
                      setCheckConfirm(null);
                    } catch (e: any) {
                      showError('Error', e?.message || 'Failed');
                    } finally { setCheckBusy(false); }
                  }}
                  className={`px-4 py-1.5 text-sm rounded text-white disabled:opacity-50 ${
                    checkConfirm === 'mark' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                  }`}>
                  {checkBusy
                    ? (checkConfirm === 'mark' ? 'Marking…' : 'Unmarking…')
                    : (checkConfirm === 'mark' ? 'Mark as Checked' : 'Unmark')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm modal — kept inside the form so the Delete button
            (above) can stay close to its trigger; rendering inside doesn't
            affect the modal since it's positioned `fixed`. */}
        {deleteOpen && editId && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
              <h3 className="font-semibold text-gray-800 mb-2">Delete Voucher</h3>
              <p className="text-sm text-gray-600 mb-5">
                Are you sure you want to delete this voucher? This will also remove all ledger entries, inventory entries and bill allocation records. <span className="font-semibold text-red-500">This cannot be undone.</span>
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDeleteOpen(false)}
                  className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await vouchersApi.deleteVoucher(editId);
                      showSuccess('Deleted', 'Voucher deleted successfully');
                      setDeleteOpen(false);
                      // Return to the Daybook (or wherever the user came from)
                      // — the deleted voucher no longer exists, so staying on
                      // the edit page would render stale state.
                      if (window.history.length > 1) navigate(-1);
                      else navigate('/billing/daybook');
                    } catch (e: any) {
                      showError('Error', e?.message || 'Failed to delete voucher');
                    } finally { setDeleting(false); }
                  }}
                  className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lead linkage banner — shown when this voucher is being created from
            a lead's Complete action. Saving will close the lead. */}
        {linkedLeadId && linkedLeadInfo && (
          <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded flex items-center gap-2 text-sm">
            <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-semibold">LEAD #{linkedLeadId}</span>
            <span className="text-emerald-900">
              Billing against <span className="font-semibold">{linkedLeadInfo.customer_name}</span>
              {linkedLeadInfo.lead_type && <span className="text-emerald-700"> · {linkedLeadInfo.lead_type}</span>}
              {linkedLeadInfo.mobile_no && <span className="text-emerald-700"> · {linkedLeadInfo.mobile_no}</span>}
            </span>
            <span className="text-[11px] text-emerald-700 italic ml-auto">Saving will close the lead</span>
          </div>
        )}

        {/* Header — Row 1: Type | No | spacer | Date (right) */}
        <div className="flex items-end gap-3 mb-2">
          <div className="w-[160px] flex-shrink-0">
            <label className="block text-[11px] text-gray-500 mb-0.5">Voucher Type</label>
            <select value={voucherType} onChange={e => setVoucherType(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400">
              {childTypes.length === 0 ? (
                voucherType
                  ? <option value={voucherType}>{voucherType}</option>
                  : <option value="">-- No types --</option>
              ) : (
                childTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)
              )}
            </select>
          </div>
          <div className="w-36 flex-shrink-0">
            <label className="block text-[11px] text-gray-500 mb-0.5">Voucher No</label>
            <input type="text" value={voucherNo} onChange={e => setVoucherNo(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. S-001"
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <div className="flex-1" />
          <div className="w-[160px] flex-shrink-0">
            <label className="block text-[11px] text-gray-500 mb-0.5">Voucher Date</label>
            <input type="date" value={voucherDate} onChange={e => setVoucherDate(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
        </div>

        {/* ══ Journal / Contra / Payment / Receipt Form ══ */}
        {isStockJournal && (() => {
          return (
            <>
              <div className="border border-gray-200 rounded mb-3 flex divide-x divide-gray-200">
                <StockSide title="Source (Consumption)" lines={stockSource} setLines={setStockSource}
                  onOpenBatch={lineId => setStockBatchPopup({ side: 'src', lineId })} />
                <StockSide title="Destination (Production)" lines={stockDest} setLines={setStockDest}
                  onOpenBatch={lineId => setStockBatchPopup({ side: 'dst', lineId })} />
              </div>
              {stockBatchPopup && stockBatchLine && (
                <StockBatchPopup
                  line={stockBatchLine}
                  onSave={rows => {
                    const totQty = rows.reduce((s, b) => s + b.qty, 0);
                    const totAmt = rows.reduce((s, b) => s + b.amount, 0);
                    const setter = stockBatchPopup.side === 'src' ? setStockSource : setStockDest;
                    setter(p => p.map(l => l.id === stockBatchPopup.lineId
                      ? { ...l, batch_rows: rows, qty: totQty, amount: totAmt }
                      : l));
                    setStockBatchPopup(null);
                  }}
                  onClose={() => setStockBatchPopup(null)}
                />
              )}
            </>
          );
        })()}

        {isJournalType && (
          <div className="border border-gray-200 rounded mb-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-[11px] text-gray-500 uppercase">
                  <th className="py-2 px-2 text-left w-[28px]">#</th>
                  <th className="py-2 px-2 text-left w-[68px]">Type</th>
                  <th className="py-2 px-2 text-left">Ledger</th>
                  <th className="py-2 px-2 text-right w-[110px]">Dr Amount</th>
                  <th className="py-2 px-2 text-right w-[110px]">Cr Amount</th>
                  <th className="py-2 px-2 w-[30px]"></th>
                </tr>
              </thead>
              <tbody>
                {journalRows.map((row, idx) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-1 px-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-1 px-1">
                      <select value={row.drOrCr}
                        onKeyDown={handleKeyDown} data-row={idx} data-field="drOrCr"
                        onChange={e => setJournalRows(p => p.map(r => r.id === row.id
                          ? { ...r, drOrCr: e.target.value as 'Dr' | 'Cr', dr_amount: 0, cr_amount: 0 }
                          : r))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                        <option value="Dr">Dr</option>
                        <option value="Cr">Cr</option>
                      </select>
                    </td>
                    <td className="py-1 px-1">
                      <div className="relative">
                        <input type="text" value={row.search}
                          ref={(el) => { journalInputRefs.current.set(row.id, el); }}
                          onKeyDown={handleKeyDown} data-row={idx} data-field="ledger"
                          onChange={e => {
                            const q = e.target.value;
                            setJournalRows(p => p.map(r => r.id === row.id
                              ? { ...r, search: q, ledger_id: null, ledger_name: '', open: q.length >= 2 }
                              : r));
                            setActiveDropIdx(0); // pre-select first match for instant Enter
                            if (q.length >= 2) {
                              customersApi.searchAllLedgers(q).then((res: any) => {
                                const list: any[] = filterJournalLedgers(res?.data || []);
                                setJournalRows(p => p.map(r => r.id === row.id ? { ...r, results: list, open: true } : r));
                              }).catch((err: any) => console.warn('[LedgerSearch]', err?.message || err));
                            }
                          }}
                          onFocus={() => {
                            if (row.search.length >= 2 && row.results.length > 0)
                              setJournalRows(p => p.map(r => r.id === row.id ? { ...r, open: true } : r));
                          }}
                          onBlur={() => setTimeout(() => {
                            // Trap focus: refuse to leave the field if user
                            // typed text but didn't select from the dropdown.
                            setJournalRows(p => {
                              const r = p.find(x => x.id === row.id);
                              if (r && !r.ledger_id && r.search.trim()) {
                                const el = journalInputRefs.current.get(row.id);
                                if (el && document.activeElement !== el) el.focus();
                              }
                              return p.map(x => x.id === row.id ? { ...x, open: false } : x);
                            });
                          }, 200)}
                          placeholder="Search ledger..."
                          // Visual cue: green when a real ledger is locked
                          // in, red when the user has typed text but not
                          // selected from the dropdown (so they immediately
                          // see the row won't save). Empty rows stay neutral.
                          className={`w-full border rounded text-sm py-1 px-2 pr-6 focus:outline-none focus:ring-1 ${
                            row.ledger_id
                              ? 'border-green-400 bg-green-50 focus:ring-green-300'
                              : row.search.trim()
                                ? 'border-red-400 bg-red-50 focus:ring-red-300'
                                : 'border-gray-200 focus:ring-blue-400'
                          }`}
                          title={row.search.trim() && !row.ledger_id ? 'Pick a ledger from the dropdown — free text is not allowed' : undefined}
                        />
                        {row.ledger_id && (row.dr_amount > 0 || row.cr_amount > 0) && (() => {
                          const balanced = isRowBillAllocBalanced(row);
                          return row.billByBill ? (
                            <button onClick={() => openBillAlloc(row.id)}
                              title={balanced ? 'Bill allocated' : 'Allocate bills'}
                              className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-bold ${balanced ? 'text-green-600' : 'text-orange-500 animate-pulse'}`}>
                              {balanced ? '✓' : '⚠'}
                            </button>
                          ) : (
                            <span title="On account" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-bold text-green-600">✓</span>
                          );
                        })()}
                        {row.open && row.results.length > 0 && (
                          <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-44 overflow-y-auto">
                            {row.results.map((l: any, lIdx: number) => (
                              <div key={l.id} onPointerDown={() => {
                                const isBillByBill = l.billbybill === 'Yes';
                                setJournalRows(p => p.map(r => r.id === row.id
                                  ? { ...r, ledger_id: l.id, ledger_name: l.company, search: l.company, open: false, billByBill: isBillByBill, billAlloc: isBillByBill ? r.billAlloc : [] }
                                  : r));
                              }} className={`px-2 py-1.5 text-sm cursor-pointer ${lIdx === activeDropIdx ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}>
                                {l.company}
                                {l.billbybill === 'Yes' && <span className={`ml-1 text-[10px] ${lIdx === activeDropIdx ? 'text-blue-200' : 'text-blue-400'}`}>bill-by-bill</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-1 px-1">
                      {row.drOrCr === 'Dr' ? (
                        <input type="number" step="any" value={row.dr_amount || ''}
                          onKeyDown={handleKeyDown} data-row={idx} data-field="dr_amount"
                          onChange={e => {
                            const v = Number(e.target.value) || 0;
                            setJournalRows(p => p.map(r => r.id === row.id ? { ...r, dr_amount: v } : r));
                          }}
                          onBlur={e => {
                            if (isJournalType) {
                              const amt = parseFloat(e.target.value) || 0;
                              const allocSigned = row.billAlloc.reduce((s, en) => s + (en.direction === 'Cr' ? -(Number(en.amount) || 0) : (Number(en.amount) || 0)), 0);
                              if (amt > 0 && (row.billAlloc.length === 0 || Math.abs(amt - allocSigned) >= 0.01)) {
                                if (row.billByBill) setTimeout(() => openBillAlloc(row.id), 50);
                                else autoFillOnAccount(row.id, amt, 'Dr');
                              }
                            }
                          }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                      ) : <span className="block text-center text-gray-300">—</span>}
                    </td>
                    <td className="py-1 px-1">
                      {row.drOrCr === 'Cr' ? (
                        <input type="number" step="any" value={row.cr_amount || ''}
                          onKeyDown={handleKeyDown} data-row={idx} data-field="cr_amount"
                          onChange={e => {
                            const v = Number(e.target.value) || 0;
                            setJournalRows(p => p.map(r => r.id === row.id ? { ...r, cr_amount: v } : r));
                          }}
                          onBlur={e => {
                            if (isJournalType) {
                              const amt = parseFloat(e.target.value) || 0;
                              const allocSigned = row.billAlloc.reduce((s, en) => s + (en.direction === 'Cr' ? -(Number(en.amount) || 0) : (Number(en.amount) || 0)), 0);
                              if (amt > 0 && (row.billAlloc.length === 0 || Math.abs(-amt - allocSigned) >= 0.01)) {
                                if (row.billByBill) setTimeout(() => openBillAlloc(row.id), 50);
                                else autoFillOnAccount(row.id, amt, 'Cr');
                              }
                            }
                          }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                      ) : <span className="block text-center text-gray-300">—</span>}
                    </td>
                    <td className="py-1 px-1 text-center">
                      {journalRows.length > 1 && (
                        <button onClick={() => setJournalRows(p => p.filter(r => r.id !== row.id))}
                          className="text-red-400 hover:text-red-600"><X size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-100">
                  <td colSpan={6} className="py-1 px-2">
                    <button onClick={() => setJournalRows(p => [...p, emptyJournalRow()])}
                      onKeyDown={handleKeyDown}
                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800">
                      <Plus size={12} /> Add Row
                    </button>
                  </td>
                </tr>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={3} className="py-2 px-2 text-sm font-bold text-gray-800">
                    Grand Total
                    {!journalBalanced && (
                      <span className="ml-2 text-xs font-normal text-red-500">
                        (Dr {fmt(journalDrTotal)} ≠ Cr {fmt(journalCrTotal)})
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right text-sm font-bold">
                    <span className="text-blue-600">{fmt(journalDrTotal)}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-sm font-bold text-gray-700">{fmt(journalCrTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ══ Normal Sales / Purchase Form ══ */}
        {/* Header — Row 2: Customer Name */}
        <div ref={customerRef} className={`relative mb-4 max-w-md ${isJournalType || isStockJournal ? 'hidden' : ''}`}>
          <label className="block text-[11px] text-gray-500 mb-0.5 flex items-center gap-2">
            Customer Name
            {partyId && partyState && (
              <span className="text-blue-500">({partyState} → {isIgst ? 'IGST' : 'CGST+SGST'})</span>
            )}
          </label>
          <div className="flex gap-1">
            <input type="text" value={partyDisplay}
              ref={customerInputRef}
              onKeyDown={handleKeyDown}
              onChange={e => { setPartyDisplay(e.target.value); setCustomerSearch(e.target.value); setPartyId(''); setShowCustomerDrop(true); setActiveDropIdx(0); }}
              onFocus={() => {
                setShowCustomerDrop(true);
                if (partyDisplay.length >= 1 && customers.length === 0) {
                  customersApi.search(partyDisplay).then((r: any) => {
                    const list = Array.isArray(r) ? r : (r?.data || []);
                    setCustomers(list);
                  }).catch(() => {});
                }
              }}
              onBlur={() => {
                // Trap focus: if user typed something but never picked a
                // customer, snap focus back to this field after dropdown
                // clicks have settled.
                setTimeout(() => {
                  if (!partyId && partyDisplay.trim() && customerInputRef.current && document.activeElement !== customerInputRef.current) {
                    customerInputRef.current.focus();
                  }
                }, 200);
              }}
              placeholder="Type to search customer..."
              // Green when a real customer is locked in, red when the user
              // typed text but didn't pick from the dropdown (so the row
              // can't save).
              className={`w-full border rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 ${
                partyId
                  ? 'border-green-400 bg-green-50 focus:ring-green-300'
                  : partyDisplay.trim()
                    ? 'border-red-400 bg-red-50 focus:ring-red-300'
                    : 'border-gray-300 focus:ring-blue-400'
              }`}
              title={partyDisplay.trim() && !partyId ? 'Pick a customer from the dropdown — free text is not allowed' : undefined} />
            {!readOnly && (
              <button onClick={() => { setShowNewCustomer(true); setCustForm(f => ({ ...f, company: partyDisplay })); setShowCustomerDrop(false); }}
                onKeyDown={handleKeyDown}
                title="New customer" className="flex-shrink-0 bg-green-500 hover:bg-green-600 text-white rounded px-2">
                <UserPlus size={14} />
              </button>
            )}
          </div>
          {showCustomerDrop && customers.length > 0 && (
            <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto mt-0.5">
              {customers.slice(0, 20).map((c: any, cIdx: number) => (
                <div key={c.id} className={`px-2 py-1.5 text-sm cursor-pointer ${cIdx === activeDropIdx ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}
                  onClick={() => selectParty(c)}>
                  <span className="font-medium">{c.company}</span>
                  {c.mobile && <span className={`text-xs ml-2 ${cIdx === activeDropIdx ? 'text-blue-100' : 'text-gray-400'}`}>{c.mobile}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Line Items Table — hidden for journal types and stock journal */}
        <div className={`border border-gray-200 rounded mb-0 ${isJournalType || isStockJournal ? 'hidden' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-[11px] text-gray-500 uppercase">
                  <th className="py-2 px-2 text-left w-[28px]">#</th>
                  <th className="py-2 px-2 text-left w-[280px]">Item</th>
                  <th className="py-2 px-2 text-right w-[72px]">Qty</th>
                  <th className="py-2 px-2 text-right w-[90px]">Rate</th>
                  <th className="py-2 px-2 text-right w-[100px]">
                    <span className="flex items-center justify-end gap-1">
                      Amount
                      <button type="button" tabIndex={-1}
                        onClick={() => setShowGst(v => !v)}
                        className="text-gray-400 hover:text-blue-500"
                        title={showGst ? 'Hide GST' : 'Show GST'}>
                        {showGst ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </span>
                  </th>
                  {showGst && <>
                    <th className="py-2 px-2 text-right w-[60px]">GST%</th>
                    {isIgst
                      ? <th className="py-2 px-2 text-right w-[80px]">IGST</th>
                      : <>
                          <th className="py-2 px-2 text-right w-[75px]">CGST</th>
                          <th className="py-2 px-2 text-right w-[75px]">SGST</th>
                        </>
                    }
                  </>}
                  <th className="py-2 px-2 w-[36px]"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-1 px-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-1 px-1">
                      {/* Custom item picker — input + absolutely-positioned
                          dropdown that always opens DOWN, plus type-to-search
                          for long item lists. Native <select> was flipping
                          upward whenever the row sat near the viewport
                          bottom. */}
                      <div className="relative">
                        <input type="text"
                          value={line.item_open ? (line.item_search ?? '') : line.item_name}
                          onKeyDown={handleKeyDown} data-row={idx} data-field="item"
                          onChange={e => {
                            updateLine(idx, 'item_search', e.target.value);
                            updateLine(idx, 'item_open', true);
                            setActiveDropIdx(0);
                          }}
                          onFocus={(e) => {
                            updateLine(idx, 'item_open', true);
                            // Seed the search with the currently-selected name so
                            // the input never appears empty when the dropdown is
                            // open. User can clear it to search fresh.
                            updateLine(idx, 'item_search', line.item_name || '');
                            setActiveDropIdx(0);
                            // Select-all so the next keystroke replaces the name
                            // rather than appending to it.
                            setTimeout(() => e.target.select(), 0);
                          }}
                          onBlur={() => setTimeout(() => updateLine(idx, 'item_open', false), 300)}
                          placeholder="-- Select Item --"
                          className={`w-full border rounded text-sm py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                            line.product_id ? 'border-green-400 bg-green-50' : 'border-gray-200'
                          }`}
                        />
                        {line.item_open && (() => {
                          const q = (line.item_search ?? '').toLowerCase();
                          const matches = products
                            .filter((p: any) => !q || (p.item_name || '').toLowerCase().includes(q))
                            .slice(0, 50);
                          return (
                            <div className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto">
                              {matches.length === 0 && (
                                <div className="px-2 py-2 text-xs text-gray-400">No items found</div>
                              )}
                              {matches.map((p: any, pIdx: number) => (
                                <div key={p.id}
                                  onPointerDown={() => {
                                    updateLine(idx, 'product_id', String(p.id));
                                    updateLine(idx, 'item_name', p.item_name);
                                    updateLine(idx, 'item_search', '');
                                    updateLine(idx, 'item_open', false);
                                    if (p.batch === 'Yes') {
                                      setTimeout(() => openBatchPopup(idx, String(p.id)), 0);
                                    } else if (p.category_id === CLOUD_CATEGORY_ID) {
                                      setTimeout(() => openCloudPopup(idx), 0);
                                    }
                                  }}
                                  className={`px-2 py-1.5 text-sm cursor-pointer ${pIdx === activeDropIdx ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}>
                                  {p.item_name}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      {(() => {
                        const prod = products.find((p: any) => String(p.id) === String(line.product_id));
                        const named = (line.batch_rows || []).filter(b => (b.batch_name || '').trim()).length;
                        // Show the button whenever the item is batch-tracked
                        // (even if no rows are saved yet) OR rows already
                        // exist — otherwise a batch item loaded into an
                        // existing voucher with empty batchRows has no way
                        // to open the popup at all.
                        if (prod?.batch !== 'Yes' && named === 0) return null;
                        return (
                          <button onClick={() => openBatchPopup(idx)}
                            className={`text-[10px] hover:underline mt-0.5 block ${named > 0 ? 'text-blue-500' : 'text-orange-500'}`}
                            title={named > 0 ? 'Edit serials' : 'Add batch / serial details'}>
                            {named > 0 ? `${named} serial(s) — edit` : 'Add batch details'}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" step="any" value={line.qty || ''}
                        onKeyDown={handleKeyDown} data-row={idx} data-field="qty"
                        onChange={e => updateLine(idx, 'qty', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" step="any" value={line.rate || ''}
                        onKeyDown={handleKeyDown} data-row={idx} data-field="rate"
                        onChange={e => updateLine(idx, 'rate', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    <td className="py-1 px-1">
                      <input type="number" step="any" value={line.amount || ''}
                        onKeyDown={handleKeyDown} data-row={idx} data-field="amount"
                        onChange={e => updateLine(idx, 'amount', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                    </td>
                    {showGst && <>
                      <td className="py-1 px-2 text-right text-gray-500 text-xs">{line.gst_rate}%</td>
                      {isIgst
                        ? <td className="py-1 px-2 text-right text-orange-500 text-xs">{fmt(line.igst_amount)}</td>
                        : <>
                            <td className="py-1 px-2 text-right text-blue-500 text-xs">{fmt(line.cgst_amount)}</td>
                            <td className="py-1 px-2 text-right text-purple-500 text-xs">{fmt(line.sgst_amount)}</td>
                          </>
                      }
                    </>}
                    <td className="py-1 px-1 text-center">
                      {lines.length > 1 && (
                        <button onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
                {!readOnly && (
                <tr className="border-t border-gray-100">
                  <td colSpan={10} className="py-1 px-2">
                    <button onClick={addRow}
                      onKeyDown={handleKeyDown}
                      className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800">
                      <Plus size={12} /> Add Item
                    </button>
                  </td>
                </tr>
                )}
              </tbody>

              {/* tfoot: Item Total → Ledger rows → Grand Total — all aligned under Amount column */}
              {(() => {
                const trailingCols = showGst ? (isIgst ? 3 : 4) : 1;
                return (
                  <tfoot>
                    {/* Item Total */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={4} className="py-1.5 px-2 text-[11px] text-gray-500 uppercase font-semibold">Item Total</td>
                      <td className="py-1.5 px-2 text-right text-sm font-semibold text-gray-800">{fmt(subtotal)}</td>
                      <td colSpan={trailingCols} />
                    </tr>

                    {/* Ledger rows */}
                    {ledgerRows.map((row, rIdx) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="py-1 px-2 text-gray-400 text-xs">{rIdx + 1}</td>
                        <td colSpan={3} className="py-1 px-2">
                          <div className="relative w-[280px]">
                            <div className={`flex items-center border rounded overflow-hidden ${
                              row.ledger_id
                                ? 'border-green-400 bg-green-50'
                                : row.search.trim()
                                  ? 'border-red-400 bg-red-50'
                                  : 'border-gray-200'
                            }`}>
                               <input type="text" value={row.search}
                                ref={(el) => { ledgerInputRefs.current.set(row.id, el); }}
                                onKeyDown={handleKeyDown} data-row={rIdx} data-field="ledger-search"
                                onChange={e => { updateLedgerRow(row.id, { search: e.target.value, ledger_id: null, open: e.target.value.trim().length >= 1 }); setActiveDropIdx(0); }}
                                onFocus={() => row.search.trim().length >= 1 && updateLedgerRow(row.id, { open: true })}
                                onBlur={() => setTimeout(() => {
                                  // Trap focus when text typed but no ledger selected.
                                  setLedgerRows(p => {
                                    const r = p.find(x => x.id === row.id);
                                    if (r && !r.ledger_id && r.search.trim()) {
                                      const el = ledgerInputRefs.current.get(row.id);
                                      if (el && document.activeElement !== el) el.focus();
                                    }
                                    return p.map(x => x.id === row.id ? { ...x, open: false } : x);
                                  });
                                }, 200)}
                                placeholder="Type to search ledger…"
                                title={row.search.trim() && !row.ledger_id ? 'Pick a ledger from the dropdown — free text is not allowed' : undefined}
                                className="flex-1 text-sm py-0.5 px-2 focus:outline-none min-w-0 bg-transparent" />
                              <ChevronDown size={12} className="mr-1 text-gray-400 flex-shrink-0" />
                            </div>
                            {row.open && row.search.trim().length >= 1 && (
                              <div className="absolute z-20 w-full bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-40 overflow-y-auto">
                                {ledgerOptions(row.search).map((l, lIdx) => (
                                  <div key={l.id} onPointerDown={() => selectLedger(row.id, l)}
                                    className={`px-2 py-1.5 text-sm cursor-pointer ${lIdx === activeDropIdx ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}>{l.company}</div>
                                ))}
                                {ledgerOptions(row.search).length === 0 && (
                                  <div className="px-2 py-2 text-xs text-gray-400">No accounts found</div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-1 px-2 text-right">
                          <input type="number" step="any" value={row.amount || ''}
                            onKeyDown={handleKeyDown} data-row={rIdx} data-field="ledger-amount"
                            onChange={e => updateLedgerRow(row.id, { amount: Number(e.target.value) || 0 })}
                            className="w-24 border border-gray-200 rounded text-sm py-0.5 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium text-gray-700" />
                        </td>
                        <td colSpan={trailingCols} className="py-1 px-1">
                          {!row.auto && (
                            <button onClick={() => removeLedgerRow(row.id)} className="text-red-400 hover:text-red-600"><X size={13} /></button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Add Ledger row */}
                    {!readOnly && (
                    <tr className="border-t border-gray-100">
                      <td colSpan={4 + 1 + trailingCols} className="py-1 px-2">
                        <button onClick={addLedgerRow}
                          onKeyDown={handleKeyDown}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                          <Plus size={12} /> Add Ledger
                        </button>
                      </td>
                    </tr>
                    )}

                    {/* Grand Total */}
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td colSpan={4} className="py-2 px-2 text-sm font-bold text-gray-800">Grand Total</td>
                      <td className="py-2 px-2 text-right">
                        {customerBillByBill ? (
                          <button onClick={openCustomerBillAlloc}
                            className={`text-base font-bold underline decoration-dotted ${billAllocBalanced ? 'text-green-600' : 'text-orange-500'}`}
                            title="Click to allocate bill">
                            {fmt(grandTotal)}
                          </button>
                        ) : (
                          <span className="text-base font-bold text-blue-600">{fmt(grandTotal)}</span>
                        )}
                      </td>
                      <td colSpan={trailingCols} />
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>

        {/* Remark + Submit */}
        <div className="flex items-center gap-3 mt-3">
          <input type="text" value={remark} onChange={e => setRemark(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Remark (optional)"
            disabled={readOnly}
            className="flex-1 border border-gray-300 rounded text-sm py-2 px-3 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500" />
          {!readOnly && (() => {
            // Block save whenever any ledger field has orphan text OR a row
            // has an amount without a ledger picked. Same rule for both
            // journal-mode and items-mode (Sales / Purchase / Credit / Debit).
            const orphanJournal = isJournalType
              ? journalRows.find(r => !r.ledger_id && r.search.trim())
              : null;
            const amtWithoutLedgerJournal = isJournalType
              ? journalRows.find(r => !r.ledger_id && (r.dr_amount > 0 || r.cr_amount > 0))
              : null;
            const orphanLedgerRow = !isJournalType
              ? ledgerRows.find(r => !r.ledger_id && r.search.trim())
              : null;
            const amtWithoutLedgerItems = !isJournalType
              ? ledgerRows.find(r => !r.ledger_id && r.amount > 0)
              : null;
            const orphanParty = !isJournalType && !partyId && partyDisplay.trim()
              ? partyDisplay.trim()
              : null;
            const blockReason = isStockJournal ? undefined :
              orphanJournal              ? `"${orphanJournal.search.trim()}" — pick a ledger from the dropdown` :
              amtWithoutLedgerJournal    ? `Row ${journalRows.indexOf(amtWithoutLedgerJournal) + 1}: pick a ledger before entering amount` :
              orphanLedgerRow            ? `"${orphanLedgerRow.search.trim()}" — pick a ledger from the dropdown` :
              amtWithoutLedgerItems      ? `Ledger row: pick a ledger before entering amount` :
              orphanParty                ? `"${orphanParty}" — pick a customer from the dropdown` :
              isJournalType && !journalBalanced ? 'Dr total must equal Cr total' :
              isJournalType && !allRowsBillAllocBalanced ? 'Complete bill allocation for all ledgers' :
              !isJournalType && !billAllocBalanced ? 'Complete bill allocation — balance must reach zero' :
              undefined;
            return (
              <button onClick={handleSubmit}
                onKeyDown={handleKeyDown}
                disabled={submitting || !!blockReason}
                title={blockReason}
                className="flex-shrink-0 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded px-5 py-2">
                <Save size={16} />
                {submitting ? (editId ? 'Updating...' : 'Submitting...') : (editId ? 'Update Voucher' : 'Save Voucher')}
              </button>
            );
          })()}
        </div>
      </fieldset>
    </div>{/* end desktop layout */}

    {/* Cloud-Activity Picker Popup — opens when a Cloud-category item is selected */}
      {cloudPopup && (() => {
        const getAmt = (a: any) => cloudPopup.isCreditNote
          ? (Number(a.purchase_amount) > 0 ? Number(a.purchase_amount) : Number(a.bill_amount || 0))
          : Number(a.bill_amount || 0);
        const total = cloudPopup.activities
          .filter(a => cloudPopup.selectedIds.has(String(a.id)))
          .reduce((s, a) => s + getAmt(a), 0);
        const allOnPage = cloudPopup.activities.length;
        const allChecked = allOnPage > 0 && cloudPopup.activities.every(a => cloudPopup.selectedIds.has(String(a.id)));
        const toggleAll = () => {
          setCloudPopup(prev => {
            if (!prev) return prev;
            const next = new Set<string>();
            if (!allChecked) prev.activities.forEach(a => next.add(String(a.id)));
            return { ...prev, selectedIds: next };
          });
        };
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div ref={cloudPopupRef} className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[85vh] flex flex-col">
              <div className="flex justify-between items-center px-5 py-3 border-b border-gray-100">
                <div>
                  <h3 className="font-semibold text-gray-800">{cloudPopup.isCreditNote ? 'Cloud Purchase Activities' : 'Cloud Billing Activities'} — {partyDisplay}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{cloudPopup.isCreditNote ? 'Pick the purchase activities for this Credit Note. Amount fills from purchase_amount.' : 'Pick the activities to bill on this voucher. The amount fills automatically.'}</p>
                </div>
                <button onClick={() => setCloudPopup(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {cloudPopup.loading ? (
                  <div className="text-center py-10 text-gray-400 text-sm">Loading…</div>
                ) : cloudPopup.activities.length === 0 ? (
                  <div className="text-center py-10 text-gray-400 text-sm">{cloudPopup.isCreditNote ? 'No pending purchase activities found for servers mapped to this customer.' : 'No pending billing activities for this customer.'}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                      <tr>
                        <th className="py-2 px-2 text-left w-8">
                          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                        </th>
                        <th className="py-2 px-2 text-left">Date</th>
                        <th className="py-2 px-2 text-left">Type</th>
                        <th className="py-2 px-2 text-left">Server</th>
                        <th className="py-2 px-2 text-left">Domain / IP</th>
                        <th className="py-2 px-2 text-left">SOF No.</th>
                        <th className="py-2 px-2 text-left">Cycle</th>
                        <th className="py-2 px-2 text-left">Period</th>
                        <th className="py-2 px-2 text-right">Units</th>
                        <th className="py-2 px-2 text-right">Rate</th>
                        <th className="py-2 px-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cloudPopup.activities.map((a, i) => {
                        const id = String(a.id);
                        const checked = cloudPopup.selectedIds.has(id);
                        const fmtShort = (d: any) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
                        const period = (a.start_from || a.new_expiry_date)
                          ? `${fmtShort(a.start_from)}${a.start_from && a.new_expiry_date ? ' → ' : ''}${fmtShort(a.new_expiry_date)}`
                          : '—';
                        const fmtAmt = (n: any) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <tr key={id} onClick={() => toggleCloudActivity(id)}
                            className={`border-t border-gray-100 cursor-pointer ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                            <td className="py-2 px-2"><input type="checkbox" checked={checked} onChange={() => toggleCloudActivity(id)} onClick={e => e.stopPropagation()} /></td>
                            <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{a.activity_date}</td>
                            <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{a.activity_type}{a.bill_type === 'Credit Note' ? ' (Cr)' : ''}</td>
                            <td className="py-2 px-2 text-gray-700 truncate max-w-[180px]" title={a.server_name || ''}>{a.server_name || '—'}</td>
                            <td className="py-2 px-2 text-gray-600 truncate max-w-[140px]" title={a.customer_domain_ip || ''}>{a.customer_domain_ip || '—'}</td>
                            <td className="py-2 px-2 text-gray-600">{a.sof_no || '—'}</td>
                            <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{a.billing_cycle || '—'}</td>
                            <td className="py-2 px-2 text-gray-600 whitespace-nowrap text-[12px]">{period}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{a.billing_units ?? '—'}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{a.last_bill_rate != null ? fmtAmt(a.last_bill_rate) : '—'}</td>
                            <td className="py-2 px-2 text-right tabular-nums font-medium whitespace-nowrap">{fmtAmt(getAmt(a))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
                <div className="text-sm">
                  <span className="text-gray-500">Selected:</span>{' '}
                  <span className="font-semibold text-gray-800 tabular-nums">{cloudPopup.selectedIds.size}</span>
                  <span className="mx-2 text-gray-300">•</span>
                  <span className="text-gray-500">Total Amount:</span>{' '}
                  <span className="font-semibold text-blue-700 tabular-nums">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setCloudPopup(null)} className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100 text-gray-600">Cancel</button>
                  <button onClick={applyCloudSelection} disabled={cloudPopup.selectedIds.size === 0}
                    className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white rounded">
                    Add Selected
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Batch Entry Popup */}
      {batchPopupIdx !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0 sm:p-4">
          <div ref={batchPopupRef} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-xl flex flex-col h-[60vh] max-h-[92vh]">
            {/* Header */}
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-gray-100 flex-shrink-0">
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Batch / Serial Entry</p>
                <h3 className="font-semibold text-gray-800 text-sm leading-tight">
                  {lines[batchPopupIdx]?.item_name || 'Item'}
                </h3>
              </div>
              <button onClick={() => setBatchPopupIdx(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            {!isPurchaseMode && batchNoFlavour && (
              <div className="mx-4 mt-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 flex-shrink-0">
                Flavour not set for this item — go to <strong>Items</strong> page and set the Tally Flavour so serials can be filtered.
              </div>
            )}

            {/* Desktop: original table layout */}
            <div className="hidden sm:flex flex-col flex-1 overflow-hidden px-4 pt-4 pb-2">
              <div className="overflow-y-auto flex-1" ref={batchScrollRef}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="text-[11px] text-gray-500 uppercase bg-gray-50">
                    <th className="py-1.5 px-2 text-left w-8">#</th>
                    <th className="py-1.5 px-2 text-left">Serial / Batch No.</th>
                    <th className="py-1.5 px-2 text-right w-20">Qty</th>
                    <th className="py-1.5 px-2 text-right w-24">Rate</th>
                    <th className="py-1.5 px-2 text-right w-28">Amount</th>
                    <th className="py-1.5 px-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {batchDraft.map((row, i) => (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="py-1 px-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="py-1 px-1">
                        {isPurchaseMode ? (
                          <input type="text" onKeyDown={handleKeyDown} data-row={i} data-field="batch_name"
                            value={row.batch_name}
                            onChange={e => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, batch_name: e.target.value } : r))}
                            placeholder="Enter serial no."
                            className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        ) : (
                          <div className="relative">
                            <input type="text" data-row={i} data-field="batch_search"
                              value={row.serialSearch ?? row.batch_name}
                              onChange={e => { setBatchSerialHiIdx(-1); setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialSearch: e.target.value, batch_name: e.target.value, serialOpen: true } : r)); }}
                              onFocus={e => {
                                setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialOpen: true } : r));
                                setBatchSerialHiIdx(-1);
                                setTimeout(() => {
                                  const scroller = batchScrollRef.current;
                                  const el = e.target;
                                  if (scroller && el) {
                                    const scrollerRect = scroller.getBoundingClientRect();
                                    const elRect = el.getBoundingClientRect();
                                    if (elRect.bottom > scrollerRect.bottom - 160) {
                                      scroller.scrollTop += elRect.bottom - scrollerRect.bottom + 160;
                                    }
                                  }
                                }, 30);
                              }}
                              onBlur={() => setTimeout(() => { setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialOpen: false } : r)); setBatchSerialHiIdx(-1); }, 150)}
                              onKeyDown={e => {
                                const usedByOthers = new Set(batchDraft.filter(r => r.id !== row.id && r.batch_name).map(r => r.batch_name));
                                const visible = batchSerials.filter(s => !usedByOthers.has(s) && (!row.serialSearch || s.toLowerCase().includes((row.serialSearch || '').toLowerCase())));
                                if (e.key === 'ArrowDown') { e.preventDefault(); setBatchSerialHiIdx(h => Math.min(h + 1, visible.length - 1)); }
                                else if (e.key === 'ArrowUp') { e.preventDefault(); setBatchSerialHiIdx(h => Math.max(h - 1, -1)); }
                                else if (e.key === 'Enter' && batchSerialHiIdx >= 0 && visible[batchSerialHiIdx]) {
                                  e.preventDefault();
                                  const s = visible[batchSerialHiIdx];
                                  setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, batch_name: s, serialSearch: s, serialOpen: false } : r));
                                  setBatchSerialHiIdx(-1);
                                } else { handleKeyDown(e as any); }
                              }}
                              placeholder="Search serial no."
                              className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            {row.serialOpen && (
                              <div className="absolute z-30 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-40 overflow-y-auto">
                                {(() => {
                                  const usedByOthers = new Set(batchDraft.filter(r => r.id !== row.id && r.batch_name).map(r => r.batch_name));
                                  const visible = batchSerials.filter(s => !usedByOthers.has(s) && (!row.serialSearch || s.toLowerCase().includes((row.serialSearch || '').toLowerCase())));
                                  return visible.length > 0 ? visible.map((s, si) => (
                                    <div key={s} onPointerDown={() => { setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, batch_name: s, serialSearch: s, serialOpen: false } : r)); setBatchSerialHiIdx(-1); }}
                                      className={`px-2 py-1.5 text-sm cursor-pointer ${si === batchSerialHiIdx ? 'bg-blue-600 text-white' : 'hover:bg-blue-50'}`}>{s}</div>
                                  )) : (
                                    <div className="px-2 py-2 text-xs text-gray-400">
                                      {batchNoFlavour ? 'Set flavour for this item in Items page' : batchSerials.length === 0 ? 'No serials found' : 'No match'}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={row.qty || ''} onKeyDown={handleKeyDown} data-row={i} data-field="batch_qty"
                          onChange={e => { const qty = Number(e.target.value) || 0; setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, qty, amount: +(qty * r.rate).toFixed(2) } : r)); }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={row.rate || ''} onKeyDown={handleKeyDown} data-row={i} data-field="batch_rate"
                          onChange={e => { const rate = Number(e.target.value) || 0; setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, rate, amount: +(r.qty * rate).toFixed(2) } : r)); }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={row.amount || ''} onKeyDown={handleKeyDown} data-row={i} data-field="batch_amount"
                          onChange={e => { const amount = Number(e.target.value) || 0; setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, amount, rate: r.qty > 0 ? +(amount / r.qty).toFixed(4) : r.rate } : r)); }}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium" />
                      </td>
                      <td className="py-1 px-1 text-center">
                        {batchDraft.length > 1 && (
                          <button onClick={() => setBatchDraft(d => d.filter(r => r.id !== row.id))} className="text-red-400 hover:text-red-600"><X size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <button onClick={() => setBatchDraft(d => [...d, { id: uid(), batch_name: '', qty: 0, rate: 0, amount: 0, serialSearch: '', serialOpen: false }])}
                onKeyDown={handleKeyDown} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 mt-2 flex-shrink-0">
                <Plus size={12} /> Add Serial No.
              </button>
            </div>

            {/* Mobile: card layout */}
            <div className="sm:hidden p-4 overflow-y-auto flex-1 space-y-3">
              {batchDraft.map((row, i) => (
                <div key={row.id} className="border border-gray-200 rounded-xl p-3 space-y-2.5 bg-gray-50/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 w-5">{i + 1}</span>
                    {batchDraft.length > 1 && (
                      <button onClick={() => setBatchDraft(d => d.filter(r => r.id !== row.id))}
                        className="ml-auto text-red-400 hover:text-red-600 p-0.5"><X size={15} /></button>
                    )}
                  </div>
                  {isPurchaseMode ? (
                    <input type="text" value={row.batch_name} onKeyDown={handleKeyDown} data-row={i} data-field="batch_name"
                      onChange={e => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, batch_name: e.target.value } : r))}
                      placeholder="Enter serial / batch no."
                      className="w-full border border-gray-300 rounded-lg text-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                  ) : (
                    <div>
                      <input type="text" onKeyDown={handleKeyDown} data-row={i} data-field="batch_search"
                        value={row.serialSearch ?? row.batch_name}
                        onChange={e => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialSearch: e.target.value, batch_name: e.target.value, serialOpen: true } : r))}
                        onFocus={() => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialOpen: true } : r))}
                        onBlur={() => setTimeout(() => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, serialOpen: false } : r)), 150)}
                        placeholder="Search serial no."
                        className="w-full border border-gray-300 rounded-lg text-sm py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                      {row.serialOpen && (
                        <div className="bg-white border border-gray-200 rounded-lg shadow-md mt-1 max-h-40 overflow-y-auto">
                          {(() => {
                            const usedByOthers = new Set(batchDraft.filter(r => r.id !== row.id && r.batch_name).map(r => r.batch_name));
                            const visible = batchSerials.filter(s => !usedByOthers.has(s) && (!row.serialSearch || s.toLowerCase().includes((row.serialSearch || '').toLowerCase())));
                            return visible.length > 0 ? visible.map(s => (
                              <div key={s} onPointerDown={() => setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, batch_name: s, serialSearch: s, serialOpen: false } : r))}
                                className="px-3 py-2.5 text-sm hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">{s}</div>
                            )) : (
                              <div className="px-3 py-3 text-xs text-gray-400 text-center">
                                {batchNoFlavour ? 'Set flavour in Items page to filter serials' : batchSerials.length === 0 ? 'No serials found for this customer' : 'No match'}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Qty</label>
                      <input type="number" inputMode="decimal" step="any" value={row.qty || ''} onKeyDown={handleKeyDown} data-row={i} data-field="batch_qty"
                        onChange={e => { const qty = Number(e.target.value) || 0; setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, qty, amount: +(qty * r.rate).toFixed(2) } : r)); }}
                        className="w-full border border-gray-300 rounded-lg text-sm py-2 px-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Rate</label>
                      <input type="number" inputMode="decimal" step="any" value={row.rate || ''} onKeyDown={handleKeyDown} data-row={i} data-field="batch_rate"
                        onChange={e => { const rate = Number(e.target.value) || 0; setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, rate, amount: +(r.qty * rate).toFixed(2) } : r)); }}
                        className="w-full border border-gray-300 rounded-lg text-sm py-2 px-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Amount</label>
                      <input type="number" inputMode="decimal" step="any" value={row.amount || ''} onKeyDown={handleKeyDown} data-row={i} data-field="batch_amount"
                        onChange={e => { const amount = Number(e.target.value) || 0; setBatchDraft(d => d.map(r => r.id === row.id ? { ...r, amount, rate: r.qty > 0 ? +(amount / r.qty).toFixed(4) : r.rate } : r)); }}
                        className="w-full border border-gray-300 rounded-lg text-sm py-2 px-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white font-medium" />
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={() => setBatchDraft(d => [...d, { id: uid(), batch_name: '', qty: 0, rate: 0, amount: 0, serialSearch: '', serialOpen: false }])}
                onKeyDown={handleKeyDown} className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-800 py-1">
                <Plus size={15} /> Add Serial No.
              </button>
            </div>

            {/* Footer — desktop compact / mobile stacked */}
            <div className="border-t border-gray-100 bg-gray-50 rounded-b-2xl sm:rounded-b-lg flex-shrink-0">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>Total Qty: <strong className="text-gray-800">{batchDraft.reduce((s, r) => s + r.qty, 0).toFixed(3)}</strong></span>
                  <span>Total Amt: <strong className="text-gray-800">₹{batchDraft.reduce((s, r) => s + r.amount, 0).toFixed(2)}</strong></span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setBatchPopupIdx(null)}
                    className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100">Cancel</button>
                  <button onClick={saveBatch}
                    className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded">Save</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div ref={newCustomerPopupRef} className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">New Customer</h3>
              <button onClick={() => setShowNewCustomer(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Company Name *</label>
                <input autoFocus type="text" value={custForm.company}
                  onKeyDown={handleKeyDown}
                  onChange={e => setCustForm(f => ({ ...f, company: e.target.value }))}
                  placeholder="Full company name"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Mobile *</label>
                <input type="text" value={custForm.mobile}
                  onKeyDown={handleKeyDown}
                  onChange={e => setCustForm(f => ({ ...f, mobile: e.target.value }))}
                  placeholder="Phone number"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">GST IN</label>
                <input type="text" value={custForm.gstin}
                  onKeyDown={handleKeyDown}
                  onChange={e => setCustForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                  placeholder="Optional"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 uppercase" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Email</label>
                <input type="email" value={custForm.email}
                  onKeyDown={handleKeyDown}
                  onChange={e => setCustForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="Optional"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Pincode</label>
                <input type="text" value={custForm.pincode}
                  onKeyDown={handleKeyDown}
                  onChange={async e => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCustForm(f => ({ ...f, pincode: v, area: '', state: '' }));
                    if (v.length === 6) {
                      try {
                        const { pincodeApi: pa } = await import('../services/api');
                        const res = await pa.lookup(v);
                        if (res.city) setCustForm(f => ({ ...f, area: res.city, state: res.state }));
                      } catch {}
                    }
                  }}
                  placeholder="6 digits"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Address Line 1</label>
                <input type="text" value={custForm.address1}
                  onKeyDown={handleKeyDown}
                  onChange={e => setCustForm(f => ({ ...f, address1: e.target.value }))}
                  placeholder="Building / Floor"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Address Line 2</label>
                <input type="text" value={custForm.address2}
                  onKeyDown={handleKeyDown}
                  onChange={e => setCustForm(f => ({ ...f, address2: e.target.value }))}
                  placeholder="Street / Area"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">City (auto)</label>
                <input readOnly value={custForm.area}
                  className="w-full border border-gray-100 rounded text-sm py-1.5 px-2 bg-gray-50 text-gray-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">State (auto)</label>
                <input readOnly value={custForm.state}
                  className="w-full border border-gray-100 rounded text-sm py-1.5 px-2 bg-gray-50 text-gray-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Ledger Group</label>
                <select value={custForm.ledgergroup}
                  onChange={e => setCustForm(f => ({ ...f, ledgergroup: Number(e.target.value) || SUNDRY_DEBTORS_ID }))}
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                  {ledgerGroups.length === 0 && <option value={SUNDRY_DEBTORS_ID}>Sundry Debtors</option>}
                  {ledgerGroups.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">Which ledger group this party files under in Tally — usually Sundry Debtors.</p>
              </div>
            </div>
            <div className="px-4 pb-4">
              <button onClick={handleCreateCustomer} disabled={creatingCustomer}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded py-2">
                {creatingCustomer ? 'Creating...' : 'Create Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill Allocation Popup */}
      {billAllocOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0 sm:p-4">
          <div ref={billAllocPopupRef} className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-gray-100 flex-shrink-0">
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Bill Allocation</p>
                <h3 className="font-semibold text-gray-800 text-sm leading-tight">
                  {isJournalType
                    ? (activeJournalRow?.ledger_name || '—')
                    : partyDisplay}
                </h3>
              </div>
              <button onClick={() => closeBillAlloc()} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            {/* Desktop: original table layout */}
            <div className="hidden sm:block p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase bg-gray-50">
                    <th className="py-1.5 px-2 text-left w-8">#</th>
                    <th className="py-1.5 px-2 text-left w-28">Type</th>
                    <th className="py-1.5 px-2 text-left">Ref / Bill No.</th>
                    <th className="py-1.5 px-2 text-right w-28">Amount</th>
                    <th className="py-1.5 px-2 text-center w-12">Cr/Dr</th>
                    <th className="py-1.5 px-2 w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {billAllocEntries.map((entry, i) => (
                    <tr key={entry.id} className="border-t border-gray-100">
                      <td className="py-1 px-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="py-1 px-1">
                        <select value={entry.type} onKeyDown={handleKeyDown} data-row={i} data-field="alloc_type"
                          onChange={e => setBillAllocEntries(d => {
                            const newType = e.target.value as any;
                            const currentBalance = +(signedGrandTotal - d.filter(r => r.id !== entry.id).reduce((s, r) => s + (r.direction === 'Cr' ? -(Number(r.amount)||0) : (Number(r.amount)||0)), 0)).toFixed(2);
                            const autoDir = currentBalance >= 0 ? 'Dr' : 'Cr';
                            const autoAmt = Math.abs(currentBalance);
                            return d.map(r => r.id === entry.id ? newType === 'New' ? { ...r, type: newType, amount: autoAmt, direction: autoDir } : { ...r, type: newType } : r);
                          })}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                          <option value="New">New</option>
                          <option value="Agr.">Agr.</option>
                          <option value="On Account">On Account</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        {entry.type === 'On Account' ? (
                          <span className="text-xs text-gray-400 px-1">—</span>
                        ) : entry.type === 'New' ? (
                          <input type="text" value={entry.refno} onKeyDown={handleKeyDown} data-row={i} data-field="alloc_ref"
                            onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refno: e.target.value } : r))}
                            placeholder="Reference / Bill No."
                            className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        ) : (
                          <div className="relative">
                            <input type="text" onKeyDown={handleKeyDown} data-row={i} data-field="alloc_search"
                              value={entry.refSearch ?? entry.refno}
                              onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refSearch: e.target.value, refno: e.target.value, refOpen: true } : r))}
                              onFocus={() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refOpen: true } : r))}
                              onBlur={() => setTimeout(() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refOpen: false } : r)), 150)}
                              placeholder="Search pending bill..."
                              className="w-full border border-gray-200 rounded text-sm py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            {entry.refOpen && (
                              <div className="absolute z-30 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 overflow-hidden" style={{minWidth:'360px'}}>
                                <div className="grid grid-cols-4 gap-0 bg-gray-100 border-b border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                                  <span>Bill No.</span><span>Date</span><span className="text-right">Amount</span><span className="text-center">Cr/Dr</span>
                                </div>
                                <div className="max-h-48 overflow-y-auto">
                                  {pendingRefs
                                    .filter(p => !billAllocEntries.some(r => r.id !== entry.id && r.refno === p.billname))
                                    .filter(p => !entry.refSearch || p.billname.toLowerCase().includes((entry.refSearch || '').toLowerCase()))
                                    .map(p => { const dir = p.direction || (Number(p.amount) > 0 ? 'Dr' : 'Cr'); return (
                                      <div key={p.billname}
                                        onPointerDown={() => setBillAllocEntries(d => {
                                          const otherAllocated = d.filter(r => r.id !== entry.id).reduce((s, r) => s + (Number(r.amount) || 0), 0);
                                          const remaining = Math.max(0, effectiveGrandTotal - otherAllocated);
                                          const autoAmount = +Math.min(Number(p.amount), remaining).toFixed(2);
                                          const billDir = p.direction || (Number(p.amount) > 0 ? 'Dr' : 'Cr');
                                          const settleDir = billDir === 'Dr' ? 'Cr' : 'Dr';
                                          return d.map(r => r.id === entry.id ? { ...r, refno: p.billname, refSearch: p.billname, amount: autoAmount, direction: settleDir, refOpen: false } : r);
                                        })}
                                        className="grid grid-cols-4 gap-0 px-2 py-1.5 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                                        <span className="text-sm font-medium text-gray-800 truncate">{p.billname}</span>
                                        <span className="text-xs text-gray-500 self-center">{p.vch_date}</span>
                                        <span className="text-xs text-gray-800 font-medium text-right self-center">₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        <span className={`text-xs font-semibold text-center self-center ${dir === 'Cr' ? 'text-green-600' : 'text-red-500'}`}>{dir}</span>
                                      </div>
                                    );})}
                                  {pendingRefs.filter(p => !billAllocEntries.some(r => r.id !== entry.id && r.refno === p.billname)).filter(p => !entry.refSearch || p.billname.toLowerCase().includes((entry.refSearch || '').toLowerCase())).length === 0 && (
                                    <div className="px-2 py-2 text-xs text-gray-400">No pending bills found</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-1 px-1">
                        <input type="number" step="any" value={entry.amount || ''} onKeyDown={handleKeyDown} data-row={i} data-field="alloc_amount"
                          onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, amount: Number(e.target.value) || 0 } : r))}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium" />
                      </td>
                      <td className="py-1 px-1 text-center">
                        {(() => {
                          const dir = entry.direction || pendingRefs.find(p => p.billname === entry.refno)?.direction;
                          return dir ? (
                            <button onClick={() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, direction: r.direction === 'Cr' ? 'Dr' : 'Cr' } : r))}
                              className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${dir === 'Cr' ? 'text-green-600 border-green-300 hover:bg-green-50' : 'text-red-500 border-red-300 hover:bg-red-50'}`}
                              title="Click to toggle Cr/Dr">{dir}</button>
                          ) : <span className="text-xs text-gray-300">—</span>;
                        })()}
                      </td>
                      <td className="py-1 px-1 text-center">
                        {billAllocEntries.length > 1 && (
                          <button onClick={() => setBillAllocEntries(d => d.filter(r => r.id !== entry.id))} className="text-red-400 hover:text-red-600"><X size={13} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setBillAllocEntries(d => {
                const usedSigned = d.reduce((s, r) => s + (r.direction === 'Cr' ? -(Number(r.amount)||0) : (Number(r.amount)||0)), 0);
                const remaining = +(signedGrandTotal - usedSigned).toFixed(2);
                const autoDir = remaining >= 0 ? 'Dr' : 'Cr';
                return [...d, { id: uid(), type: 'New', refno: '', amount: Math.abs(remaining), direction: autoDir }];
              })} onKeyDown={handleKeyDown} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 mt-2">
                <Plus size={12} /> Add Reference
              </button>
            </div>

            {/* Mobile: card layout */}
            <div className="sm:hidden px-3 py-3 overflow-y-auto flex-1 space-y-2">
              {billAllocEntries.map((entry, i) => (
                <div key={entry.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  {/* Row 1: # | Segmented type toggle | Dr/Cr | Delete */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <span className="text-[10px] text-gray-400 w-4 shrink-0">{i + 1}</span>
                    <div className="flex-1 flex rounded-lg border border-gray-200 overflow-hidden text-xs bg-gray-50">
                      {(['New', 'Agr.', 'On Account'] as const).map(t => (
                        <button key={t} type="button" onKeyDown={handleKeyDown}
                          onClick={() => setBillAllocEntries(d => {
                            const currentBalance = +(signedGrandTotal - d.filter(r => r.id !== entry.id).reduce((s, r) => s + (r.direction === 'Cr' ? -(Number(r.amount)||0) : (Number(r.amount)||0)), 0)).toFixed(2);
                            const autoDir = currentBalance >= 0 ? 'Dr' : 'Cr';
                            const autoAmt = Math.abs(currentBalance);
                            return d.map(r => r.id === entry.id ? t === 'New' ? { ...r, type: t, amount: autoAmt, direction: autoDir } : { ...r, type: t } : r);
                          })}
                          className={`flex-1 py-1.5 font-semibold transition-colors border-r border-gray-200 last:border-r-0 ${
                            entry.type === t ? 'bg-blue-600 text-white' : 'text-gray-500'
                          }`}>
                          {t}
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const dir = entry.direction || pendingRefs.find(p => p.billname === entry.refno)?.direction;
                      return dir ? (
                        <button type="button" onClick={() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, direction: r.direction === 'Cr' ? 'Dr' : 'Cr' } : r))}
                          className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border shrink-0 ${dir === 'Cr' ? 'text-green-600 border-green-200 bg-green-50' : 'text-red-500 border-red-200 bg-red-50'}`}>{dir}</button>
                      ) : null;
                    })()}
                    {billAllocEntries.length > 1 && (
                      <button type="button" onClick={() => setBillAllocEntries(d => d.filter(r => r.id !== entry.id))} className="text-red-400 p-0.5 shrink-0"><X size={14} /></button>
                    )}
                  </div>
                  {/* Row 2: Ref. no. (left) | Amount (right) — side by side */}
                  <div className="flex border-t border-gray-100 divide-x divide-gray-100">
                    {entry.type !== 'On Account' && (
                      <div className="flex-1 px-3 py-2 relative min-w-0">
                        <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">
                          {entry.type === 'New' ? 'Ref. No.' : 'Bill'}
                        </p>
                        {entry.type === 'New' ? (
                          <input type="text" value={entry.refno} onKeyDown={handleKeyDown} data-row={i} data-field="alloc_ref"
                            onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refno: e.target.value } : r))}
                            placeholder="e.g. INV-001"
                            className="w-full text-sm text-gray-800 bg-transparent border-none outline-none truncate" />
                        ) : (
                          <>
                            <input type="text" onKeyDown={handleKeyDown} data-row={i} data-field="alloc_search"
                              value={entry.refSearch ?? entry.refno}
                              onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refSearch: e.target.value, refno: e.target.value, refOpen: true } : r))}
                              onFocus={() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refOpen: true } : r))}
                              onBlur={() => setTimeout(() => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, refOpen: false } : r)), 150)}
                              placeholder="Search pending bill..."
                              className="w-full text-sm text-gray-800 bg-transparent border-none outline-none truncate" />
                            {entry.refOpen && (
                              <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden" style={{ top: '100%' }}>
                                <div className="grid grid-cols-4 bg-gray-100 border-b border-gray-200 px-2 py-1.5 text-[9px] font-semibold text-gray-500 uppercase tracking-wide">
                                  <span>Bill</span><span>Date</span><span className="text-right">Amt</span><span className="text-center">D/C</span>
                                </div>
                                <div className="max-h-40 overflow-y-auto">
                                  {pendingRefs
                                    .filter(p => !billAllocEntries.some(r => r.id !== entry.id && r.refno === p.billname))
                                    .filter(p => !entry.refSearch || p.billname.toLowerCase().includes((entry.refSearch || '').toLowerCase()))
                                    .map(p => {
                                      const dir = p.direction || (Number(p.amount) > 0 ? 'Dr' : 'Cr');
                                      return (
                                        <div key={p.billname}
                                          onPointerDown={() => setBillAllocEntries(d => {
                                            const otherAllocated = d.filter(r => r.id !== entry.id).reduce((s, r) => s + (Number(r.amount) || 0), 0);
                                            const remaining = Math.max(0, effectiveGrandTotal - otherAllocated);
                                            const autoAmount = +Math.min(Number(p.amount), remaining).toFixed(2);
                                            const billDir = p.direction || (Number(p.amount) > 0 ? 'Dr' : 'Cr');
                                            const settleDir: 'Dr' | 'Cr' = billDir === 'Dr' ? 'Cr' : 'Dr';
                                            return d.map(r => r.id === entry.id ? { ...r, refno: p.billname, refSearch: p.billname, amount: autoAmount, direction: settleDir, refOpen: false } : r);
                                          })}
                                          className="grid grid-cols-4 px-2 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                                          <span className="text-xs font-semibold text-gray-800 truncate">{p.billname}</span>
                                          <span className="text-[10px] text-gray-500 self-center">{p.vch_date}</span>
                                          <span className="text-xs text-gray-800 font-medium text-right self-center">₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                          <span className={`text-[10px] font-bold text-center self-center ${dir === 'Cr' ? 'text-green-600' : 'text-red-500'}`}>{dir}</span>
                                        </div>
                                      );
                                    })}
                                  {pendingRefs.filter(p => !billAllocEntries.some(r => r.id !== entry.id && r.refno === p.billname)).filter(p => !entry.refSearch || p.billname.toLowerCase().includes((entry.refSearch || '').toLowerCase())).length === 0 && (
                                    <div className="px-3 py-3 text-xs text-gray-400 text-center">No pending bills found</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {/* Amount — fixed width right column (full width for On Account) */}
                    <div className={`${entry.type !== 'On Account' ? 'w-[130px] shrink-0' : 'flex-1'} px-3 py-2 bg-blue-50 flex flex-col justify-center`}>
                      <p className="text-[9px] text-blue-400 uppercase tracking-wide mb-0.5">Amount</p>
                      <input type="number" inputMode="decimal" step="any" value={entry.amount || ''} onKeyDown={handleKeyDown} data-row={i} data-field="alloc_amount"
                        onChange={e => setBillAllocEntries(d => d.map(r => r.id === entry.id ? { ...r, amount: Number(e.target.value) || 0 } : r))}
                        className="w-full text-sm font-bold text-blue-700 bg-transparent border-none outline-none text-right" />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setBillAllocEntries(d => {
                const usedSigned = d.reduce((s, r) => s + (r.direction === 'Cr' ? -(Number(r.amount)||0) : (Number(r.amount)||0)), 0);
                const remaining = +(signedGrandTotal - usedSigned).toFixed(2);
                const autoDir = remaining >= 0 ? 'Dr' : 'Cr';
                return [...d, { id: uid(), type: 'New', refno: '', amount: Math.abs(remaining), direction: autoDir }];
              })} onKeyDown={handleKeyDown} className="flex items-center gap-1.5 text-sm text-green-600 py-1.5">
                <Plus size={15} /> Add Reference
              </button>
            </div>

            {/* Footer — desktop: compact horizontal / mobile: stacked full-width */}
            <div className="border-t border-gray-100 bg-gray-50 rounded-b-2xl sm:rounded-b-lg flex-shrink-0">
              {/* Desktop footer */}
              <div className="hidden sm:flex items-center justify-between px-4 py-3">
                <div className="flex gap-4 text-xs">
                  <span className="text-gray-500">Grand Total: <strong className="text-gray-800">{fmt(effectiveGrandTotal)}</strong> <span className="text-[10px] font-semibold text-gray-400">{signedGrandTotal >= 0 ? 'Dr.' : 'Cr.'}</span></span>
                  <span className="text-gray-500">Allocated: <strong className={billAllocBalanced ? 'text-green-600' : 'text-orange-500'}>{fmt(Math.abs(billAllocSigned))}</strong> <span className={`text-[10px] font-semibold ${billAllocBalanced ? 'text-green-500' : 'text-orange-400'}`}>{billAllocSigned >= 0 ? 'Dr.' : 'Cr.'}</span></span>
                  <span className="text-gray-500">Balance: <strong className={billAllocBalanced ? 'text-green-600' : 'text-red-500'}>{fmt(Math.abs(billAllocBalance))}</strong> <span className={`text-[10px] font-semibold ${billAllocBalanced ? 'text-green-500' : 'text-red-400'}`}>{billAllocBalance >= 0 ? 'Dr.' : 'Cr.'}</span></span>
                </div>
                <button onClick={() => closeBillAlloc()} disabled={!billAllocBalanced}
                  title={!billAllocBalanced ? 'Allocated total must equal Grand Total' : undefined}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white rounded">Done</button>
              </div>
              {/* Mobile footer */}
              <div className="sm:hidden px-4 py-3 space-y-2.5">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-gray-500">Total: <strong className="text-gray-800">₹{fmt(effectiveGrandTotal)}</strong> <span className="text-[10px] font-semibold text-gray-400">{signedGrandTotal >= 0 ? 'Dr.' : 'Cr.'}</span></span>
                  <span className="text-gray-500">Allocated: <strong className={billAllocBalanced ? 'text-green-600' : 'text-orange-500'}>₹{fmt(Math.abs(billAllocSigned))}</strong></span>
                  <span className="text-gray-500">Balance: <strong className={billAllocBalanced ? 'text-green-600' : 'text-red-500'}>₹{fmt(Math.abs(billAllocBalance))}</strong></span>
                </div>
                <button onClick={() => closeBillAlloc()} disabled={!billAllocBalanced}
                  title={!billAllocBalanced ? 'Allocated total must equal Grand Total' : undefined}
                  className="w-full py-2.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white rounded-xl font-medium">
                  {billAllocBalanced ? 'Done' : `Balance: ₹${fmt(Math.abs(billAllocBalance))} remaining`}
                </button>
              </div>
          </div>
        </div>
      </div>
    )}
    </div>

      {/* ── Print-only invoice preview layout ── */}
      {isSalesType && partyId && lines.some(l => l.product_id) && (
        <div className="print-only">
          <div className="invoice-page bg-white text-slate-900 mx-auto" style={{ maxWidth: '820px', minHeight: '1100px' }}>
            <style>{`
              @media print {
                @page { size: A4; margin: 10mm; }
                .invoice-page { box-shadow: none !important; max-width: 100% !important; }
              }
            `}</style>
            <div className="shadow-sm border border-slate-200 print:border-0 print:shadow-none p-8 print:p-0">
              {/* Header */}
              <div className="flex items-start gap-4 pb-4 border-b border-slate-200">
                {printCompany.logo_url && (
                  <img src={printCompany.logo_url} alt={printCompany.name}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    className="w-20 h-20 object-contain flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-2xl font-bold text-emerald-800">{printCompany.name}</div>
                  <div className="text-[12px] text-slate-700 whitespace-pre-line">{printCompany.address}</div>
                  <div className="text-[12px] text-slate-700 mt-1">
                    ✉ {printCompany.email}  &nbsp;·&nbsp;  ☎ {printCompany.phone}
                  </div>
                  <div className="text-[12px] font-semibold text-slate-800 mt-0.5">GSTIN: {printCompany.gstin}</div>
                </div>
              </div>

              {/* Title */}
              <div className="text-center py-4">
                <div className="text-2xl font-bold text-emerald-800 tracking-wide">TAX INVOICE</div>
              </div>

              {/* Invoice + Bill To */}
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="border border-slate-200 rounded p-3 bg-slate-50/50">
                  <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Invoice Details</div>
                  <KV label="Invoice No."     value={voucherNo || '—'} />
                  <KV label="Invoice Date"    value={displayDate(voucherDate)} />
                  <KV label="Due Date"        value={displayDate(addDays(voucherDate, 15))} />
                  <KV label="Place of Supply" value={printBillTo.state || 'Assam'} />
                  <KV label="Reverse Charge"  value="No" />
                  <KV label="Payment Terms"   value="Due within 15 Days" />
                </div>
                <div className="border border-slate-200 rounded p-3 bg-slate-50/50">
                  <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Bill To</div>
                  <div className="font-semibold text-[14px] text-slate-900">{printBillTo.name || partyDisplay || '—'}</div>
                  {[printBillTo.address1, printBillTo.address2, [printBillTo.city, printBillTo.state, printBillTo.pincode].filter(Boolean).join(', ')].filter(Boolean).map((l, i) => (
                    <div key={i} className="text-[12px] text-slate-700">{l}</div>
                  ))}
                  <div className="mt-1.5 space-y-0.5">
                    {printBillTo.gstin   && <KV label="GSTIN"          value={printBillTo.gstin} />}
                    {printBillTo.contact && <KV label="Contact Person" value={printBillTo.contact} />}
                    {printBillTo.phone   && <KV label="Phone"          value={printBillTo.phone} />}
                    {printBillTo.email   && <KV label="Email"          value={printBillTo.email} />}
                  </div>
                </div>
              </div>

              {/* Items table */}
              <table className="w-full border-collapse text-[12px] mb-3">
                <thead>
                  <tr className="bg-emerald-800 text-white">
                    <th className="border border-emerald-900 px-2 py-2 text-left w-12">Sr. No.</th>
                    <th className="border border-emerald-900 px-2 py-2 text-left">Description</th>
                    <th className="border border-emerald-900 px-2 py-2 text-left w-20">SAC</th>
                    <th className="border border-emerald-900 px-2 py-2 text-left w-20">GST Rate</th>
                    <th className="border border-emerald-900 px-2 py-2 text-right w-14">Qty</th>
                    <th className="border border-emerald-900 px-2 py-2 text-right w-24">Rate (₹)</th>
                    <th className="border border-emerald-900 px-2 py-2 text-right w-28">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.filter(l => l.product_id).map((it, i) => {
                    const prod = products.find(p => String(p.id) === String(it.product_id));
                    return (
                      <tr key={i}>
                        <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{i + 1}.</td>
                        <td className="border border-slate-200 px-2 py-1.5">{it.item_name}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{prod?.hsn || '—'}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{it.gst_rate}%</td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(it.rate)}</td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(it.amount)}</td>
                      </tr>
                    );
                  })}
                  {lines.filter(l => l.product_id).length > 0 && (
                    <>
                      <tr>
                        <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{lines.filter(l => l.product_id).length + 1}.</td>
                        <td colSpan={5} className="border border-slate-200 px-2 py-1.5 text-right font-semibold">Total Taxable Amount</td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(subtotal)}</td>
                      </tr>
                      {!isIgst && totalCgst > 0 && (
                        <tr>
                          <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{lines.filter(l => l.product_id).length + 2}.</td>
                          <td colSpan={3} className="border border-slate-200 px-2 py-1.5"></td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right">CGST</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">—</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(totalCgst)}</td>
                        </tr>
                      )}
                      {!isIgst && totalSgst > 0 && (
                        <tr>
                          <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{lines.filter(l => l.product_id).length + 3}.</td>
                          <td colSpan={3} className="border border-slate-200 px-2 py-1.5"></td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right">SGST</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">—</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(totalSgst)}</td>
                        </tr>
                      )}
                      {isIgst && totalIgst > 0 && (
                        <tr>
                          <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{lines.filter(l => l.product_id).length + 2}.</td>
                          <td colSpan={3} className="border border-slate-200 px-2 py-1.5"></td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right">IGST</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">—</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{fmt(totalIgst)}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{lines.filter(l => l.product_id).length + (isIgst ? 3 : 4)}.</td>
                        <td colSpan={5} className="border border-slate-200 px-2 py-1.5 text-right font-semibold">Total GST Amount</td>
                        <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(totalCgst + totalSgst + totalIgst)}</td>
                      </tr>
                      <tr className="bg-emerald-50">
                        <td className="border border-slate-200 px-2 py-2 text-center tabular-nums">{lines.filter(l => l.product_id).length + (isIgst ? 4 : 5)}.</td>
                        <td colSpan={5} className="border border-slate-200 px-2 py-2 text-right font-bold text-emerald-800 uppercase tracking-wide">Total Amount Payable</td>
                        <td className="border border-slate-200 px-2 py-2 text-right tabular-nums font-bold text-emerald-800">{fmt(grandTotal)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>

              {/* Amount in words */}
              {lines.filter(l => l.product_id).length > 0 && (
                <div className="mb-3 p-2.5 bg-slate-50/50 border border-slate-200 rounded">
                  <div className="text-[11px] font-bold text-slate-700 uppercase">Amount in Words:</div>
                  <div className="text-[13px] font-medium text-slate-800">{numberToWords(grandTotal)}</div>
                </div>
              )}

              {/* Footer: bank | terms | sign */}
              {(() => {
                const activeBank = printBanks.find(b => b.id === printActiveBankId) || printBanks[0] || DEFAULT_BANK;
                return (
                  <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-200">
                    <div>
                      <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Bank Details</div>
                      <KV label="Account Name" value={activeBank.account_name} />
                      <KV label="Account Number" value={activeBank.account_number} />
                      <KV label="IFSC Code" value={activeBank.ifsc} />
                      <KV label="Bank Name" value={activeBank.bank_name} />
                      {activeBank.branch && <KV label="Branch" value={activeBank.branch} />}
                      {(activeBank.upi_id || activeBank.qr_image) && (
                        <div className="mt-2 flex items-start gap-3">
                          {activeBank.qr_image && (
                            <img src={activeBank.qr_image} alt="UPI QR"
                              className="w-20 h-20 object-contain border border-slate-200 rounded bg-white flex-shrink-0" />
                          )}
                          {activeBank.upi_id && (
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] text-slate-500">UPI ID:</div>
                              <div className="text-[12px] font-medium break-all">{activeBank.upi_id}</div>
                              <div className="text-[10px] text-slate-500">Scan & Pay</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Terms & Conditions</div>
                      <ol className="text-[11px] text-slate-700 space-y-1">
                        {printTerms.map((t, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="text-slate-400 tabular-nums">{i + 1}.</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="text-center">
                      <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">For {printCompany.name}</div>
                      <div className="h-20"></div>
                      <div className="border-t border-slate-400 mx-auto pt-1 text-[11px] text-slate-700" style={{ maxWidth: '200px' }}>
                        Authorised Signatory
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="text-center text-[11px] text-emerald-700 font-medium pt-3 mt-3 border-t border-slate-200">
  'Subject to Guwahati Jurisdiction.',/n
  'This is a computer generated invoice and does not require physical signature.'/n
                ♥ Thank you for your business!
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Vouchers;
