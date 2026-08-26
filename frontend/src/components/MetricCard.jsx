import React from "react";
import { formatCurrency, formatINR } from "../utils/format";
import "./MetricCard.css";

export default function MetricCard({ title, value, subtitle, colorClass = "", isCurrency = "USD" }) {
  const display = isCurrency === "INR" ? formatINR(value) : formatCurrency(value);
  return (
    <div className={`metric-card ${colorClass}`}>
      <p className="metric-title">{title}</p>
      <p className="metric-value">{display}</p>
      {subtitle && <p className="metric-subtitle">{subtitle}</p>}
    </div>
  );
}
