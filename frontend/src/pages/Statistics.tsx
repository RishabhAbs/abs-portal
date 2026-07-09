import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RefreshCw, BarChart3 } from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

type VoucherType = { name: string; count: number };
type AccountRow = { label: string; count: number };

export default function Statistics() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const [loading, setLoading] = useState(false);
  const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([]);
  const [voucherTotal, setVoucherTotal] = useState(0);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await vouchersApi.getStatistics();
      if (res.success) {
        setVoucherTypes(res.data.voucherTypes || []);
        setVoucherTotal(res.data.voucherTotal || 0);
        setAccounts(res.data.accounts || []);
      }
    } catch {
      showError('Error', 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: 'contain' }}>
      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
            <ChevronLeft size={20} />
          </button>
          <BarChart3 size={18} className="text-blue-600" />
          <h1 className="text-[17px] font-bold text-slate-800">Statistics</h1>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Refresh">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Body: two panels ── */}
      <div className="flex-1 min-h-0 overflow-auto bg-slate-100 p-3">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-blue-400" />
            Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-5xl mx-auto">

            {/* ── Types of Vouchers ── */}
            <div className="bg-white rounded-lg border border-slate-300 overflow-hidden">
              <div className="bg-slate-200 px-4 py-2 border-b border-slate-300">
                <h2 className="text-[13px] font-bold text-slate-700 uppercase tracking-widest text-center">Types of Vouchers</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {voucherTypes.length === 0 ? (
                  <div className="px-4 py-8 text-center text-slate-400 text-sm">No voucher types</div>
                ) : voucherTypes.map((v, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-1.5 hover:bg-blue-50">
                    <span className="text-[13px] font-semibold text-slate-800">{v.name}</span>
                    <span className={`text-[13px] tabular-nums ${v.count > 0 ? 'font-bold text-blue-700' : 'text-slate-400'}`}>{v.count}</span>
                  </div>
                ))}
              </div>
              {/* Total */}
              <div className="flex items-center justify-between px-4 py-2 bg-slate-100 border-t-2 border-slate-300">
                <span className="text-[13px] font-bold text-slate-700 uppercase tracking-wide">Total</span>
                <span className="text-[14px] font-bold tabular-nums text-slate-900">{voucherTotal}</span>
              </div>
            </div>

            {/* ── Types of Accounts ── */}
            <div className="bg-white rounded-lg border border-slate-300 overflow-hidden self-start">
              <div className="bg-slate-200 px-4 py-2 border-b border-slate-300">
                <h2 className="text-[13px] font-bold text-slate-700 uppercase tracking-widest text-center">Types of Accounts</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {accounts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-slate-400 text-sm">No data</div>
                ) : accounts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2 hover:bg-blue-50">
                    <span className="text-[13px] font-semibold text-slate-800">{a.label}</span>
                    <span className={`text-[13px] tabular-nums ${a.count > 0 ? 'font-bold text-blue-700' : 'text-slate-400'}`}>{a.count}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
