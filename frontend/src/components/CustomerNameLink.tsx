import React from 'react';
import { useNavigate } from 'react-router-dom';

type Props = {
  customerId?: number | string | null;
  name?: string | null;
  className?: string;
  fallback?: React.ReactNode;
};

/**
 * Renders a customer name. When `customerId` is present, the name becomes a
 * clickable link to the Customer Search page (/search) pre-loaded with that
 * customer — same auto-load path already used by the CRM module.
 * Falls through to plain text when no id is available.
 */
const CustomerNameLink: React.FC<Props> = ({ customerId, name, className = '', fallback }) => {
  const navigate = useNavigate();
  const display = name || fallback || '—';
  if (!customerId) return <span className={className}>{display}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate('/search', { state: { customerId: Number(customerId) } });
      }}
      className={`text-left text-blue-700 hover:underline hover:text-blue-900 ${className}`}
      title="Open customer profile"
    >
      {display}
    </button>
  );
};

export default CustomerNameLink;
