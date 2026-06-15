import React, { useState, useEffect } from 'react';
import { X, RotateCcw } from 'lucide-react';

export interface FilterConfig {
  key: string;
  label: string;
  type: 'select' | 'date' | 'text' | 'number';
  options?: { value: string; label: string }[];
  placeholder?: string;
  className?: string; // Optional grid hints e.g. 'col-span-2'
}

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  config: FilterConfig[];
  currentFilters: Record<string, any>;
  onApply: (filters: Record<string, any>) => void;
  onReset: () => void;
}

const FilterModal: React.FC<FilterModalProps> = ({
  isOpen,
  onClose,
  title = 'Filter',
  config,
  currentFilters,
  onApply,
  onReset,
}) => {
  const [localFilters, setLocalFilters] = useState<Record<string, any>>({});

  useEffect(() => {
    if (isOpen) setLocalFilters({ ...currentFilters });
  }, [isOpen, currentFilters]);

  if (!isOpen) return null;

  const handleChange = (key: string, value: any) =>
    setLocalFilters(prev => ({ ...prev, [key]: value }));

  const handleApply = () => { onApply(localFilters); onClose(); };
  const handleResetLocal = () => { onReset(); onClose(); };

  // Compact, minimal control class — same look across text/select/date/number.
  const controlCls =
    'w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-800 ' +
    'focus:ring-1 focus:ring-blue-300 focus:border-blue-400 outline-none';

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — slim and subdued */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — multi-column grid, refined */}
        <div className="px-4 py-3 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
            {config.map((field) => (
              <div key={field.key} className={field.className}>
                <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  {field.label}
                </label>

                {field.type === 'select' && (
                  <select
                    value={localFilters[field.key] || 'all'}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className={controlCls}
                  >
                    <option value="all">All</option>
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'date' && (
                  <input
                    type="date"
                    value={localFilters[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className={controlCls}
                  />
                )}

                {field.type === 'text' && (
                  <input
                    type="text"
                    value={localFilters[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder || ''}
                    className={controlCls}
                  />
                )}

                {field.type === 'number' && (
                  <input
                    type="number"
                    value={localFilters[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder || ''}
                    className={controlCls}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer — compact buttons aligned right */}
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-gray-100 bg-gray-50/40">
          <button
            onClick={handleResetLocal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilterModal;
