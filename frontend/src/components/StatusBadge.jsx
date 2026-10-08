const OUTCOME_MAP = {
  SETTLED:          { cls: 'badge-settled',   label: 'Settled' },
  REJECTED:         { cls: 'badge-rejected',  label: 'Rejected' },
  DUPLICATE_DROPPED:{ cls: 'badge-duplicate', label: 'Duplicate' },
  INVALID:          { cls: 'badge-invalid',   label: 'Invalid' },
  PENDING:          { cls: 'badge-pending',   label: 'Pending' },
};

export default function StatusBadge({ status }) {
  const { cls, label } = OUTCOME_MAP[status] ?? { cls: 'badge-pending', label: status };
  return <span className={`badge ${cls}`}>{label}</span>;
}
