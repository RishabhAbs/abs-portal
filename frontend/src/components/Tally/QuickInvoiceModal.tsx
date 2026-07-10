import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Building2, Tag, RefreshCw, Package, Plus } from 'lucide-react';

import { itemsApi, vchTypeApi, vouchersApi, customersApi, pincodeApi, tallyApi } from '../../services/api';
import { useToast } from '../Toast/Toast';

const MY_STATE = 'Assam';

interface QuickInvoiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    data: {
        customerId: number;
        companyName: string;
        tallyserial?: string;
        tallyFlavourId?: number;
    };
}

const QuickInvoiceModal: React.FC<QuickInvoiceModalProps> = ({ isOpen, onClose, onSuccess, data }) => {
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [items, setItems] = useState<any[]>([]);
    const [itemId, setItemId] = useState('');
    const [qty, setQty] = useState(1);
    const [rate, setRate] = useState(0);
    // For batch-tracked items, qty is derived from how many serial rows are
    // filled in — one unit per serial, same model as the full Voucher form.
    const [serials, setSerials] = useState<string[]>(['']);

    // Sales-family voucher types the invoice can be filed under. Defaults
    // to "Tally Billing" (this popup bills Tally serial renewals), falling
    // back to "Tax Invoice" until that type exists.
    const [vchTypes, setVchTypes] = useState<{ id: number; name: string }[]>([]);
    const [vchTypeId, setVchTypeId] = useState<number | ''>('');
    const [suggestedVchNo, setSuggestedVchNo] = useState('');
    const [isIgst, setIsIgst] = useState(false);

    // Load everything the voucher needs the moment the modal opens: the item
    // list to pick from, the Tax Invoice type (so we know its id + can ask
    // for the next number), and the customer's state (for CGST/SGST vs IGST).
    useEffect(() => {
        if (!isOpen) return;
        setItemId(''); setQty(1); setRate(0); setSuggestedVchNo(''); setIsIgst(false); setSerials(['']);
        setLoading(true);
        (async () => {
            try {
                const today = new Date().toISOString().split('T')[0];
                const [itemsRes, typesRes, customerRes] = await Promise.all([
                    itemsApi.getAll(),
                    vchTypeApi.getAll(),
                    customersApi.getById(String(data.customerId)),
                ]);
                // Only active items are billable in the quick-invoice picker.
                const allItems = (itemsRes.success ? (itemsRes.data || []) : []).filter((i: any) => Number(i.active) !== 0);
                setItems(allItems);

                // This report row already tells us which flavour the serial
                // is on — if exactly one item matches it, pick it for the
                // user instead of making them find it in a long list.
                if (data.tallyFlavourId) {
                    const matches = allItems.filter((i: any) => Number(i.tally_flavour_id) === data.tallyFlavourId);
                    if (matches.length === 1) {
                        const item = matches[0];
                        setItemId(String(item.id));
                        setRate(Number(item.opening_rate) || 0);
                        setSerials(item.batch === 'Yes' && data.tallyserial ? [data.tallyserial] : ['']);
                    }
                }

                const allTypes = typesRes.success ? (typesRes.data || []) : [];
                const sales = allTypes.find((t: any) => t.name?.toLowerCase() === 'sales');
                // Whole Sales family (sub-types of sub-types included)
                const byId = new Map(allTypes.map((x: any) => [x.id, x]));
                const inSalesFamily = (t: any) => {
                    if (!sales) return false;
                    let cur: any = t;
                    for (let hops = 0; cur && hops < 20; hops++) {
                        if (cur.id === sales.id) return true;
                        if (cur.parent_id === cur.id || cur.parent_id == null) return false;
                        cur = byId.get(cur.parent_id);
                    }
                    return false;
                };
                const children = allTypes.filter((t: any) => sales && t.id !== sales.id && inSalesFamily(t) && Number(t.active) !== 0);
                setVchTypes(children);
                const def = children.find((t: any) => t.name.toLowerCase() === 'tally billing')
                    ?? children.find((t: any) => t.name.toLowerCase() === 'tax invoice')
                    ?? children[0];
                if (def) {
                    setVchTypeId(def.id);
                    const noRes = await vouchersApi.getNextNo(def.id, today);
                    if (noRes.success) setSuggestedVchNo(noRes.data || '');
                } else {
                    showError('Setup missing', 'No voucher types found under Sales — set one up in Vch Types first.');
                }

                if (customerRes?.success && customerRes.data) {
                    const c = customerRes.data;
                    let stateName = '';
                    if (c.state && isNaN(Number(c.state))) stateName = c.state;
                    else if (c.pincode) {
                        try {
                            const pr = await pincodeApi.lookup(String(c.pincode).replace(/\D/g, ''));
                            if (pr?.state && isNaN(Number(pr.state))) stateName = pr.state;
                        } catch { /* ignore */ }
                    }
                    setIsIgst(stateName ? stateName.toLowerCase() !== MY_STATE.toLowerCase() : false);
                }
            } catch (e: any) {
                showError('Error', e?.message || 'Failed to load voucher setup');
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, data.customerId]);

    // Switching the voucher type pulls that type's own next number, so the
    // header chip always previews the series the invoice will actually use.
    const handlePickVchType = async (id: number) => {
        setVchTypeId(id);
        setSuggestedVchNo('');
        try {
            const today = new Date().toISOString().split('T')[0];
            const noRes = await vouchersApi.getNextNo(id, today);
            if (noRes.success) setSuggestedVchNo(noRes.data || '');
        } catch { /* chip just shows Manual no. */ }
    };

    const selectedItem = useMemo(() => items.find(i => String(i.id) === itemId), [items, itemId]);

    // Narrow the picker to items on the serial's own flavour — falls back to
    // the full list if nothing is configured for that flavour so the user
    // is never stuck with an empty dropdown.
    const flavourMatches = useMemo(
        () => data.tallyFlavourId ? items.filter(i => Number(i.tally_flavour_id) === data.tallyFlavourId) : items,
        [items, data.tallyFlavourId]
    );
    const filteredItems = flavourMatches.length ? flavourMatches : items;
    const isFlavourFiltered = !!data.tallyFlavourId && flavourMatches.length > 0 && flavourMatches.length < items.length;

    const handlePickItem = (id: string) => {
        setItemId(id);
        const item = items.find(i => String(i.id) === id);
        if (item) setRate(Number(item.opening_rate) || 0);
        // Opened from a Tally renewal report row — that row's own serial is
        // the one being renewed, so pre-fill it instead of asking the user
        // to retype/paste it.
        setSerials(item?.batch === 'Yes' && data.tallyserial ? [data.tallyserial] : ['']);
        setQty(1);
    };

    const isBatchItem = selectedItem?.batch === 'Yes';
    // This modal renews one specific Tally serial — when that serial is
    // known, lock it to a single, non-editable row instead of letting the
    // user retype it or add unrelated extra serials.
    const serialLocked = isBatchItem && !!data.tallyserial;
    const filledSerials = serials.map(s => s.trim()).filter(Boolean);
    // Batch items: qty is derived from filled serial rows, not user-typed.
    const effectiveQty = isBatchItem ? filledSerials.length : qty;

    const addSerialRow = () => setSerials(prev => [...prev, '']);
    const removeSerialRow = (idx: number) => setSerials(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
    const updateSerialRow = (idx: number, value: string) => setSerials(prev => prev.map((s, i) => i === idx ? value : s));

    const amount = +(effectiveQty * rate).toFixed(2);
    const gstRate = Number(selectedItem?.gst) || 0;
    const cgstAmount = isIgst ? 0 : +(amount * gstRate / 2 / 100).toFixed(2);
    const sgstAmount = isIgst ? 0 : +(amount * gstRate / 2 / 100).toFixed(2);
    const igstAmount = isIgst ? +(amount * gstRate / 100).toFixed(2) : 0;
    const grandTotal = +(amount + cgstAmount + sgstAmount + igstAmount).toFixed(2);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!vchTypeId) { showError('Setup missing', 'Select a voucher type.'); return; }
        if (!itemId) { showError('Validation', 'Select an item.'); return; }
        if (rate <= 0) { showError('Validation', 'Enter a rate.'); return; }
        if (isBatchItem) {
            if (filledSerials.length === 0) {
                showError('Validation', `"${selectedItem.item_name}" requires at least one serial / batch number.`);
                return;
            }
            if (serials.some(s => !s.trim())) {
                showError('Validation', 'Remove the empty serial row or fill it in before saving.');
                return;
            }
        } else if (qty <= 0) {
            showError('Validation', 'Quantity must be greater than 0.');
            return;
        }

        setSaving(true);
        try {
            const today = new Date().toISOString().split('T')[0];
            const res: any = await vouchersApi.create({
                vch_type_id: vchTypeId,
                vch_no: suggestedVchNo || undefined,
                vch_date: today,
                party_ledger_id: data.customerId,
                is_igst: isIgst,
                items: [{
                    item_id: Number(itemId),
                    qty: effectiveQty, rate, amount,
                    gst_rate: gstRate,
                    cgst_amount: cgstAmount,
                    sgst_amount: sgstAmount,
                    igst_amount: igstAmount,
                    batch_rows: isBatchItem
                        ? filledSerials.map(name => ({ batch_name: name, qty: 1, rate, amount: rate }))
                        : null,
                }],
                ledgers: [],
                // "New" ties this to a fresh bill reference (the backend uses the
                // saved vch_no as that reference automatically) — but only when
                // a number actually got assigned. If numbering is manual and no
                // number came back, "New" would have nothing to name the bill
                // after, so file it "On Account" instead.
                bill_allocation: [{
                    type: suggestedVchNo ? 'New' : 'On Account',
                    refno: '',
                    amount: grandTotal,
                    direction: 'Dr',
                }],
            });
            if (res.success) {
                const savedNo = res.data?.vch_no;
                // Stamp the serial as Billed in the expiry report — this is
                // the only path that sets Billed status (requires the real
                // voucher id). Fail-soft: the voucher itself already saved.
                if (data.tallyserial && res.data?.id) {
                    try {
                        await tallyApi.markBilled({ tallyserial: data.tallyserial, voucher_id: res.data.id });
                    } catch { /* voucher saved; billed marker is best-effort */ }
                }
                showSuccess('Voucher created', savedNo ? `Saved as ${savedNo}` : 'Saved');
                onSuccess();
                onClose();
            } else {
                showError('Error', res.message || 'Failed to create voucher');
            }
        } catch (error: any) {
            showError('Error', error.message || 'Failed to create voucher');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white flex-shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-green-50 rounded-lg flex-shrink-0">
                            <Package className="h-5 w-5 text-green-600" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-gray-900 leading-tight">Quick Sales Invoice</h2>
                            <p className="text-xs text-gray-500 font-medium italic truncate">Pick an item — everything else is automatic</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors group flex-shrink-0">
                        <X className="h-5 w-5 text-gray-400 group-hover:text-gray-600" />
                    </button>
                </div>

                {/* Company Info Bar */}
                <div className="px-6 py-3 bg-blue-50/50 border-b border-blue-100 flex items-center justify-between gap-3 flex-shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="h-4 w-4 text-blue-600 flex-shrink-0" />
                        <span className="text-sm font-bold text-blue-900 truncate">{data.companyName}</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1 bg-white border border-blue-200 rounded text-[11px] font-mono text-blue-700 shadow-sm flex-shrink-0">
                        <Tag className="h-3 w-3" />
                        {suggestedVchNo || (loading ? '…' : 'Manual no.')}
                    </div>
                </div>

                {loading ? (
                    <div className="p-10 flex justify-center text-gray-400">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Voucher Type</label>
                                <select
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm"
                                    value={vchTypeId}
                                    onChange={e => handlePickVchType(Number(e.target.value))}
                                >
                                    {vchTypes.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Item</label>
                                <select
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:bg-white transition-all outline-none text-sm"
                                    value={itemId}
                                    onChange={e => handlePickItem(e.target.value)}
                                >
                                    <option value="">-- Select Item --</option>
                                    {filteredItems.map(i => (
                                        <option key={i.id} value={i.id}>{i.item_name}{i.batch === 'Yes' ? ' (batch-tracked)' : ''}</option>
                                    ))}
                                </select>
                                {isFlavourFiltered && (
                                    <p className="text-[11px] text-gray-400 ml-1">Showing items matching this serial's flavour only.</p>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Quantity</label>
                                    <input
                                        type="number" min={0.001} step="any"
                                        disabled={isBatchItem}
                                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm ${isBatchItem ? 'bg-gray-100 text-gray-500' : 'bg-gray-50'}`}
                                        value={isBatchItem ? effectiveQty : qty}
                                        onChange={e => setQty(Number(e.target.value) || 0)}
                                        title={isBatchItem ? 'Derived from the number of serials entered below' : undefined}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Rate</label>
                                    <input
                                        type="number" min={0} step="any"
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm"
                                        value={rate}
                                        onChange={e => setRate(Number(e.target.value) || 0)}
                                    />
                                </div>
                            </div>

                            {isBatchItem && (
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Serial / Batch No.</label>
                                    <div className="space-y-1.5">
                                        {serials.map((s, idx) => (
                                            <div key={idx} className="flex items-center gap-1.5">
                                                <input
                                                    type="text"
                                                    autoFocus={idx === 0}
                                                    disabled={serialLocked}
                                                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:bg-white transition-all outline-none text-sm ${serialLocked ? 'bg-gray-100 text-gray-500' : 'bg-gray-50'}`}
                                                    placeholder="Enter serial / batch no."
                                                    value={s}
                                                    onChange={e => updateSerialRow(idx, e.target.value)}
                                                    title={serialLocked ? 'This is the serial being renewed' : undefined}
                                                />
                                                {!serialLocked && serials.length > 1 && (
                                                    <button type="button" onClick={() => removeSerialRow(idx)} className="p-1 text-red-400 hover:text-red-600 flex-shrink-0">
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {!serialLocked && (
                                        <button type="button" onClick={addSerialRow} className="flex items-center gap-1 text-xs font-semibold text-green-600 hover:text-green-700 mt-1">
                                            <Plus className="h-3.5 w-3.5" /> Add another serial
                                        </button>
                                    )}
                                </div>
                            )}

                            {itemId && (
                                <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-1.5 text-[13px]">
                                    <div className="flex justify-between text-gray-500"><span>Taxable amount</span><span className="tabular-nums text-gray-700">₹{amount.toFixed(2)}</span></div>
                                    {isIgst ? (
                                        <div className="flex justify-between text-gray-500"><span>IGST ({gstRate}%)</span><span className="tabular-nums text-gray-700">₹{igstAmount.toFixed(2)}</span></div>
                                    ) : (
                                        <>
                                            <div className="flex justify-between text-gray-500"><span>CGST ({(gstRate / 2)}%)</span><span className="tabular-nums text-gray-700">₹{cgstAmount.toFixed(2)}</span></div>
                                            <div className="flex justify-between text-gray-500"><span>SGST ({(gstRate / 2)}%)</span><span className="tabular-nums text-gray-700">₹{sgstAmount.toFixed(2)}</span></div>
                                        </>
                                    )}
                                    <div className="flex justify-between items-baseline font-bold text-gray-900 pt-2 mt-1 border-t border-gray-200">
                                        <span className="text-sm">Grand Total</span>
                                        <span className="tabular-nums text-lg text-blue-700">₹{grandTotal.toFixed(2)}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end items-center gap-3 px-6 py-4 border-t border-gray-100 bg-white flex-shrink-0">
                            <button type="button" onClick={onClose} className="px-5 py-2 text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors">
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving || !itemId}
                                className={`px-8 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5 transition-all active:scale-95 flex items-center gap-2 ${saving || !itemId ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default QuickInvoiceModal;
