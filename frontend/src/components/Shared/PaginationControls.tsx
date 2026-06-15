import React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  totalItems?: number;
  itemsPerPage?: number;
  className?: string; // Additional classes
  sticky?: boolean;
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  loading = false,
  totalItems,
  itemsPerPage = 50,
  className = '',
  sticky = true
}) => {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems || 0);

  const handlePrev = () => {
    if (currentPage > 1 && !loading) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages && !loading) {
      onPageChange(currentPage + 1);
    }
  };

  // Generate page numbers to show (e.g., 1, 2, 3 ... 10)
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5; // How many numbers to show
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  if (totalPages <= 1 && !totalItems) return null;

  return (
    <div className={`flex flex-col md:flex-row items-center justify-between gap-4 py-3 bg-white border-t border-b ${sticky ? 'sticky top-0 z-20 shadow-sm' : ''} ${className}`}>
      {/* Loading Overlay Helper */}
      {loading && (
        <div className="absolute inset-0 bg-white/50 z-30 flex items-center justify-center cursor-not-allowed">
           {/* Spinner is usually handled by parent table, but controls should also be non-interactive */}
        </div>
      )}

      {/* Summary Text */}
      <div className="text-[11px] text-gray-500 font-bold uppercase tracking-widest pl-4">
        {totalItems !== undefined ? (
          <>
            Showing <span className="text-gray-900 font-extrabold">{startItem}</span> to <span className="text-gray-900 font-extrabold">{endItem}</span> of <span className="text-gray-900 font-extrabold">{totalItems}</span>
          </>
        ) : (
          <>Page {currentPage} of {totalPages}</>
        )}
        {loading && <span className="ml-2 inline-flex items-center text-blue-600"><Loader2 className="h-3 w-3 animate-spin mr-1"/> Loading</span>}
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-2 pr-4">
        <button
          onClick={handlePrev}
          disabled={currentPage === 1 || loading}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Previous Page"
        >
          <ChevronLeft className="h-4 w-4 text-gray-600" />
        </button>

        <div className="flex items-center gap-1">
          {getPageNumbers().map(p => (
            <button
              key={p}
              onClick={() => !loading && onPageChange(p)}
              disabled={loading}
              className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${
                p === currentPage
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={handleNext}
          disabled={currentPage >= totalPages || loading}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Next Page"
        >
          <ChevronRight className="h-4 w-4 text-gray-600" />
        </button>
      </div>
    </div>
  );
};

export default PaginationControls;
