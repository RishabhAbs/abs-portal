import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Shield, ChevronRight, Download } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

import QRCode from 'qrcode';

const Login: React.FC = () => {
  // Load saved credentials
  const saved = (() => { try { const d = localStorage.getItem('abs_remember'); return d ? JSON.parse(d) : null; } catch { return null; } })();
  const [email, setEmail] = useState(saved?.email || '');
  const [password, setPassword] = useState(saved?.password || '');
  const [rememberMe, setRememberMe] = useState(!!saved);
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string, otpauthUrl: string } | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showOtp && (!email.trim() || !password.trim())) {
      setError('Please enter both email and password');
      return;
    }
    if (showOtp && !otp.trim()) {
      setError('Please enter the 2FA code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const result = await login(email.trim(), password, otp);

      if (result.require_2fa) {
        setShowOtp(true);
        setSetupData(null);
        setLoading(false);
        setError('');
        return;
      }

      if (result.setup_2fa && result.otpauthUrl && result.secret) {
        setSetupData({ secret: result.secret, otpauthUrl: result.otpauthUrl });
        setShowOtp(true);
        setError('');

        // Generate QR Code
        try {
          const url = await QRCode.toDataURL(result.otpauthUrl);
          setQrCodeUrl(url);
        } catch (err) {
          setError('Failed to generate QR code');
        }

        setLoading(false);
        return;
      }

      if (result.success) {
        // Save or clear remembered credentials
        if (rememberMe) {
          localStorage.setItem('abs_remember', JSON.stringify({ email: email.trim(), password }));
        } else {
          localStorage.removeItem('abs_remember');
        }
        navigate('/');
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#e8ecf2]">
      <div className="w-full max-w-[440px] bg-white p-10 rounded-2xl shadow-lg border border-slate-100">

        <div className="flex flex-col items-center mb-8">
          <div className="mb-6">
            <img src="/logo.png" alt="ABS" className="h-12 w-auto" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            {showOtp ? 'Security Check' : 'Admin Portal'}
          </h2>
          <p className="mt-2 text-slate-500 text-sm">
            {showOtp ? 'Enter your 2FA code' : 'Sign in to manage infrastructure'}
          </p>
        </div>

        {error && (
          <div className="p-4 mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-start gap-3 animate-in slide-in-from-top-1">
            <Shield className="h-5 w-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!showOtp ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1.5 tracking-wider">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                  placeholder="name@company.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">Password</label>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                />
                <span className="text-xs text-slate-500 font-medium">Remember me</span>
              </label>
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              {setupData ? (
                <div className="flex flex-col items-center space-y-4">
                  <p className="text-center text-sm text-slate-600 px-4">
                    <strong>Admin Security:</strong><br />You must set up 2FA to continue.
                  </p>
                  <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-sm">
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="2FA QR Code" className="w-40 h-40" />
                    ) : (
                      <div className="w-40 h-40 flex items-center justify-center text-xs text-slate-400">Loading QR...</div>
                    )}
                  </div>
                  <p className="text-xs text-center text-slate-500 max-w-[280px]">
                    Scan this with Google Authenticator, then enter the code below.
                  </p>
                </div>
              ) : (
                <div className="flex justify-center my-4">
                  <div className="p-6 bg-slate-50 rounded-full border border-slate-100">
                    <Lock className="h-8 w-8 text-red-600" />
                  </div>
                </div>
              )}

              <div>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 text-center text-3xl tracking-[0.5em] font-bold font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
                  placeholder="000000"
                  autoFocus
                  maxLength={6}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 focus:ring-4 focus:ring-red-500/30 disabled:bg-red-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] mt-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </span>
            ) : (
              showOtp ? (setupData ? 'Verify & Enable 2FA' : 'Verify Login') : 'Sign In'
            )}
          </button>

          {showOtp && (
            <button
              type="button"
              onClick={() => { setShowOtp(false); setSetupData(null); setOtp(''); }}
              className="w-full text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors py-2"
            >
              Cancel Verification
            </button>
          )}
        </form>

        {!isNativeApp && (
          <a
            href="/abs-cloud.apk"
            download
            className="w-full mt-6 py-3 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] no-underline"
          >
            <Download className="h-4 w-4" />
            Install App
          </a>
        )}

        <div className="pt-8 mt-8 text-center border-t border-slate-100">
          <p className="text-xs font-medium">
            <span className="text-red-400">© 2026 ABS Technologies</span><br />
            <span className="text-slate-400">Internal System</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
