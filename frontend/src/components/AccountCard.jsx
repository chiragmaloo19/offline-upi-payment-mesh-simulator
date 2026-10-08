function fmt(raw) {
  if (raw == null) return '—';
  // Mongoose Decimal128 serializes as { "$numberDecimal": "1000.00" } or plain number
  const val = typeof raw === 'object' && raw.$numberDecimal
    ? parseFloat(raw.$numberDecimal)
    : parseFloat(raw);
  return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountCard({ account }) {
  return (
    <div className="account-card">
      <div className="account-name">{account.holderName}</div>
      <div className="account-vpa">{account.vpa}</div>
      <div className="account-balance">{fmt(account.balance)}</div>
      <div className="account-balance-label">Available Balance</div>
    </div>
  );
}
