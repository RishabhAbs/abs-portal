import React, { useState, useEffect } from 'react';
import { X, Calendar, Phone, MessageSquare, Save, Building2, Tag, RefreshCw, User } from 'lucide-react';

import { vouchersApi } from '../../services/api';
import { useToast } from '../Toast/Toast';

interface BillFollowupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    data: {
        ledger_id: number;
        party_name: string;
        bill_name: string;
        status?: string | null;
        person_name?: string | null;
        phone_number?: string | null;
        next_date?: string | null;
        remark?: string | null;
        contacts?: { person: string | null; mobile: string; is_primary: boolean }[];
    };
}

// Free-typed contact info might not exactly match any saved contact — use
// this sentinel so the dropdown can show "Custom" instead of silently
// snapping to the first option or looking unselected.
const CUSTOM_CONTACT = '__custom__';

const STATUS_OPTIONS = ['Followup', 'Payment', 'Error', 'Frustitting'];

const BillFollowupModal: React.FC<BillFollowupModalProps> = ({ isOpen, onClose, onSuccess, data }) => {
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(false);

    const [form, setForm] = useState({
        status: 'Followup',
        person_name: '',
        phone_number: '',
        next_date: '',
        remark: '',
    });
    // Which dropdown entry is picked — an index into data.contacts, or
    // CUSTOM_CONTACT when the current person/number was typed by hand
    // (or predates the contacts list) rather than matching one on file.
    const [selectedContact, setSelectedContact] = useState<string>(CUSTOM_CONTACT);

    useEffect(() => {
        if (isOpen && data) {
            const personName = data.person_name || '';
            const phoneNumber = data.phone_number || '';
            setForm({
                status: data.status || 'Followup',
                person_name: personName,
                phone_number: phoneNumber,
                next_date: data.next_date ? data.next_date.split('T')[0] : '',
                remark: data.remark || '',
            });
            const contacts = data.contacts || [];
            const matchIdx = contacts.findIndex(c => c.mobile === phoneNumber && (c.person || '') === personName);
            setSelectedContact(matchIdx >= 0 ? String(matchIdx) : CUSTOM_CONTACT);
        }
    }, [isOpen, data]);

    const contacts = data.contacts || [];
    const handleContactPick = (value: string) => {
        setSelectedContact(value);
        if (value === CUSTOM_CONTACT) return;
        const picked = contacts[Number(value)];
        if (picked) setForm(f => ({ ...f, person_name: picked.person || '', phone_number: picked.mobile }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await vouchersApi.upsertBillFollowup({
                ledger_id: data.ledger_id,
                bill_name: data.bill_name,
                status: form.status,
                person_name: form.person_name,
                phone_number: form.phone_number,
                next_date: form.next_date,
                remark: form.remark,
            });
            showSuccess('Success', 'Followup updated');
            onSuccess();
            onClose();
        } catch (error: any) {
            showError('Error', error.message || 'Failed to update');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 rounded-lg">
                            <Phone className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Update Payment Followup</h2>
                            <p className="text-xs text-gray-500 font-medium italic">Log interaction and set next follow-up</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors group">
                        <X className="h-5 w-5 text-gray-400 group-hover:text-gray-600" />
                    </button>
                </div>

                {/* Party / Bill Info Bar */}
                <div className="px-6 py-3 bg-blue-50/50 border-b border-blue-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-bold text-blue-900">{data.party_name}</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1 bg-white border border-blue-200 rounded text-[11px] font-mono text-blue-700 shadow-sm">
                        <Tag className="h-3 w-3" />
                        {data.bill_name}
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6">
                    <div className="space-y-6">
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-green-700 mb-1">
                                <Calendar className="h-4 w-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Followup Status & Contact</span>
                                <div className="flex-1 h-px bg-green-100"></div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Status</label>
                                    <select
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:bg-white transition-all outline-none text-sm font-medium"
                                        value={form.status}
                                        onChange={e => setForm({ ...form, status: e.target.value })}
                                    >
                                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Next Followup Date</label>
                                    <input
                                        type="date"
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:bg-white transition-all outline-none text-sm"
                                        value={form.next_date}
                                        onChange={e => setForm({ ...form, next_date: e.target.value })}
                                    />
                                </div>

                                {contacts.length > 0 && (
                                    <div className="md:col-span-2 space-y-1">
                                        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">
                                            Connected Contacts
                                        </label>
                                        <select
                                            className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm"
                                            value={selectedContact}
                                            onChange={e => handleContactPick(e.target.value)}
                                        >
                                            {contacts.map((c, i) => (
                                                <option key={i} value={i}>{c.person || 'Unnamed'} — {c.mobile}{c.is_primary ? ' (Primary)' : ''}</option>
                                            ))}
                                            <option value={CUSTOM_CONTACT}>Custom / Other…</option>
                                        </select>
                                    </div>
                                )}

                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1 flex items-center gap-1">
                                        <User className="h-3 w-3" /> Person Name
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Who you spoke to…"
                                        readOnly={selectedContact !== CUSTOM_CONTACT}
                                        title={selectedContact !== CUSTOM_CONTACT ? "Pick \"Custom / Other\" above to edit" : undefined}
                                        className={`w-full px-3 py-2 border rounded-lg transition-all outline-none text-sm ${
                                            selectedContact !== CUSTOM_CONTACT
                                                ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                                                : 'bg-gray-50 border-gray-300 focus:ring-2 focus:ring-blue-500 focus:bg-white'
                                        }`}
                                        value={form.person_name}
                                        onChange={e => { setForm({ ...form, person_name: e.target.value }); setSelectedContact(CUSTOM_CONTACT); }}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1 flex items-center gap-1">
                                        <Phone className="h-3 w-3" /> Number
                                    </label>
                                    <input
                                        type="tel"
                                        placeholder="Contact number…"
                                        readOnly={selectedContact !== CUSTOM_CONTACT}
                                        title={selectedContact !== CUSTOM_CONTACT ? "Pick \"Custom / Other\" above to edit" : undefined}
                                        className={`w-full px-3 py-2 border rounded-lg transition-all outline-none text-sm ${
                                            selectedContact !== CUSTOM_CONTACT
                                                ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                                                : 'bg-gray-50 border-gray-300 focus:ring-2 focus:ring-blue-500 focus:bg-white'
                                        }`}
                                        value={form.phone_number}
                                        onChange={e => { setForm({ ...form, phone_number: e.target.value }); setSelectedContact(CUSTOM_CONTACT); }}
                                    />
                                </div>

                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1 flex items-center gap-1">
                                        <MessageSquare className="h-3 w-3" /> Remark
                                    </label>
                                    <textarea
                                        rows={2}
                                        placeholder="Summarize the discussion details..."
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm resize-none"
                                        value={form.remark}
                                        onChange={e => setForm({ ...form, remark: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end items-center gap-3 mt-8 pt-5 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2 text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`px-8 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5 transition-all active:scale-95 flex items-center gap-2 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {loading ? 'Saving Changes...' : 'Save Update'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BillFollowupModal;
