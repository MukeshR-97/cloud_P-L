import { formatCurrency, formatINR } from "../utils/format";
import "./MetricCard.css";

export default function MetricCard({ title, value, subtitle, colorClass = "", isCurrency = "USD", icon: Icon }) {
  const display = isCurrency === "INR" ? formatINR(value) : formatCurrency(value);
  return (
    <div className={`metric-card ${colorClass}`}>
      <div className="metric-top">
        <p className="metric-title">{title}</p>
        {Icon && <div className={`metric-icon-wrap ${colorClass}`}><Icon size={16} strokeWidth={2}/></div>}
      </div>
      <p className="metric-value">{display}</p>
      {subtitle && <p className="metric-subtitle">{subtitle}</p>}
    </div>
  );
}
