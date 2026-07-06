import React from 'react';
import { X, History, RefreshCw } from 'lucide-react';

export interface HistoryEntry {
  when: string | null;           // created_at
  status: string | null;
  person?: string | null;
  phone?: string | null;
  next_date?: string | null;
  remark?: string | null;
  by?: string | null;
}

interface UpdateHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;                 // e.g. "AAI TRADERS — ABST/13/26-27"
  subtitle?: string;
  loading: boolean;
  entries: HistoryEntry[];
}

const fmtDateTime = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return s;
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};
const fmtDate = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB');
};

/** Read-only timeline of every update logged for one bill / serial.
 *  Newest first — mirrors the order the backend returns. */
const UpdateHistoryModal: React.FC<UpdateHistoryModalProps> = ({ isOpen, onClose, title, subtitle, loading, entries }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden border border-gray-200"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0">
              <History className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-gray-900 leading-tight truncate">{title}</h2>
              <p className="text-xs text-gray-500 truncate">{subtitle || 'Update history — newest first'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full flex-shrink-0">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-10 flex justify-center text-gray-400"><RefreshCw className="h-5 w-5 animate-spin" /></div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              No updates logged yet.
              <div className="text-xs mt-1">History starts recording from the first save made after this feature was added.</div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {entries.map((e, i) => (
                <div key={i} className="border border-gray-200 rounded-xl px-3.5 py-2.5 bg-gray-50/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                      {e.status || '—'}
                    </span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmtDateTime(e.when)}</span>
                  </div>
                  {(e.person || e.phone) && (
                    <div className="text-[12px] text-gray-700 mt-1.5">
                      {e.person}{e.person && e.phone ? ' · ' : ''}{e.phone}
                    </div>
                  )}
                  {e.next_date && (
                    <div className="text-[12px] text-gray-500 mt-0.5">Next followup: <span className="font-medium text-gray-700">{fmtDate(e.next_date)}</span></div>
                  )}
                  {e.remark && (
                    <div className="text-[12px] text-gray-600 mt-1 whitespace-pre-wrap">{e.remark}</div>
                  )}
                  {e.by && (
                    <div className="text-[10px] text-gray-400 mt-1.5">by {e.by}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center flex-shrink-0">
          <span className="text-[11px] text-gray-400">{entries.length} update(s)</span>
          <button onClick={onClose} className="px-4 py-1.5 text-sm font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
};

export default UpdateHistoryModal;
