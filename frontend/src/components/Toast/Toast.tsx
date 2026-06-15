import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  solution?: string;
  code?: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

interface ToastContextType {
  showToast: (type: ToastType, title: string, message: string, solution?: string, code?: string) => void;
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string, solution?: string, code?: string) => void;
  showWarning: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const showToast = useCallback((type: ToastType, title: string, message: string, solution?: string, code?: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, type, title, message, solution, code }]);

    // Auto remove after 5 seconds (longer for errors)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, type === 'error' ? 8000 : 5000);
  }, []);

  const showSuccess = useCallback((title: string, message: string) => showToast('success', title, message), [showToast]);
  const showError = useCallback((title: string, message: string, solution?: string, code?: string) => showToast('error', title, message, solution, code), [showToast]);
  const showWarning = useCallback((title: string, message: string) => showToast('warning', title, message), [showToast]);
  const showInfo = useCallback((title: string, message: string) => showToast('info', title, message), [showToast]);

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmModal({ options, resolve });
    });
  }, []);

  const handleConfirm = (confirmed: boolean) => {
    if (confirmModal) {
      confirmModal.resolve(confirmed);
      setConfirmModal(null);
    }
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
    }
  };

  const getColors = (type: ToastType) => {
    switch (type) {
      case 'success': return 'bg-green-50 border-green-500 text-green-800';
      case 'error': return 'bg-red-50 border-red-500 text-red-800';
      case 'warning': return 'bg-yellow-50 border-yellow-500 text-yellow-800';
      case 'info': return 'bg-blue-50 border-blue-500 text-blue-800';
    }
  };

  const getIconBg = (type: ToastType) => {
    switch (type) {
      case 'success': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'warning': return 'bg-yellow-500';
      case 'info': return 'bg-blue-500';
    }
  };

  const contextValue = useMemo(() => ({ showToast, showSuccess, showError, showWarning, showInfo, showConfirm }), [showToast, showSuccess, showError, showWarning, showInfo, showConfirm]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={() => handleConfirm(false)}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full animate-scale-in overflow-hidden">
            {/* Header */}
            <div className={`px-6 py-4 ${confirmModal.options.type === 'danger' ? 'bg-red-50' :
              confirmModal.options.type === 'warning' ? 'bg-amber-50' : 'bg-blue-50'
              }`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${confirmModal.options.type === 'danger' ? 'bg-red-100 text-red-600' :
                  confirmModal.options.type === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
                  }`}>
                  {confirmModal.options.type === 'danger' ? (
                    <Trash2 className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {confirmModal.options.title || 'Confirm Action'}
                </h3>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-4">
              <p className="text-gray-600 text-sm leading-relaxed">
                {confirmModal.options.message}
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3">
              <button
                onClick={() => handleConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                {confirmModal.options.cancelText || 'Cancel'}
              </button>
              <button
                onClick={() => handleConfirm(true)}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${confirmModal.options.type === 'danger'
                  ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  : confirmModal.options.type === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
                    : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                  }`}
              >
                {confirmModal.options.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 space-y-3 max-w-md">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`${getColors(toast.type)} border-l-4 rounded-lg shadow-lg p-4 animate-slide-in`}
          >
            <div className="flex items-start">
              <div className={`${getIconBg(toast.type)} text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold mr-3 flex-shrink-0`}>
                {getIcon(toast.type)}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold">{toast.title}</h4>
                  <button
                    onClick={() => removeToast(toast.id)}
                    className="text-gray-400 hover:text-gray-600 ml-2"
                  >
                    ×
                  </button>
                </div>
                <p className="text-sm mt-1">{toast.message}</p>
                {toast.code && (
                  <p className="text-xs mt-1 font-mono bg-white/50 px-2 py-1 rounded">
                    Code: {toast.code}
                  </p>
                )}
                {toast.solution && (
                  <div className="mt-2 text-sm bg-white/50 p-2 rounded">
                    <span className="font-medium">💡 Solution: </span>
                    {toast.solution}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-slide-in { animation: slide-in 0.3s ease-out; }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
        .animate-scale-in { animation: scale-in 0.2s ease-out; }
      `}</style>
    </ToastContext.Provider>
  );
};
