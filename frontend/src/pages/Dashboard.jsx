import { useEffect, useState, useCallback } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Activity, BarChart2, RefreshCw, Calendar } from "lucide-react";
import { getDashboardSummary } from "../api";
import MetricCard from "../components/MetricCard";
import { formatCurrency, formatINR } from "../utils/format";
import "./Dashboard.css";

const COLORS = {
  cloud_service_cost: "#6366f1",
  marketplace_cost:   "#8b5cf6",
  ilios_spend:        "#f97316",
  invoice_to_customer:"#22c55e",
  ilios_margin:       "#14b8a6",
};

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [currency, setCurrency] = useState("USD");

  const fetchSummary = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate)   params.to_date   = toDate;
      const { data } = await getDashboardSummary(params);
      setSummary(data);
    } catch { setError("Failed to load dashboard data."); }
    finally  { setLoading(false); }
  }, [fromDate, toDate]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const fmt    = currency === "INR" ? formatINR : formatCurrency;
  const fmtK   = (v) => currency === "INR" ? `₹${(v/100000).toFixed(0)}L` : `$${(v/1000).toFixed(0)}k`;
  const suffix = currency === "INR" ? "_inr" : "";

  const customTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="chart-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map(e => (
          <p key={e.dataKey} style={{ color: e.color, margin: "2px 0" }}>
            {e.name}: {fmt(e.value)}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="dash-header">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="dash-sub">Overall cost &amp; margin analysis</p>
        </div>
        <div className="dash-controls">
          <div className="filter-row">
            <div className="date-input-wrap">
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From"/>
            </div>
            <div className="date-input-wrap">
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} placeholder="To"/>
            </div>
            <button onClick={fetchSummary} className="btn-primary">
              <RefreshCw size={14}/>Apply
            </button>
            <button onClick={() => { setFromDate(""); setToDate(""); }} className="btn-secondary">
              Clear
            </button>
          </div>
          <div className="currency-toggle">
            <button className={currency === "USD" ? "active" : ""} onClick={() => setCurrency("USD")}>USD</button>
            <button className={currency === "INR" ? "active" : ""} onClick={() => setCurrency("INR")}>INR ₹</button>
          </div>
        </div>
      </div>

      {loading && <div className="loading-msg">Loading dashboard…</div>}
      {error   && <div className="error-msg">{error}</div>}

      {!loading && summary && (
        <>
          {/* KPI Cards */}
          <div className="metric-grid">
            <MetricCard title="Total Consumption"
              value={summary.totals[`total_consumption${suffix}`]}
              subtitle={`${summary.record_count} record(s)`}
              colorClass="blue" isCurrency={currency} icon={DollarSign}/>
            <MetricCard title="ILIOS Spend"
              value={summary.totals[`ilios_spend${suffix}`]}
              subtitle="After all deductions"
              colorClass="orange" isCurrency={currency} icon={Activity}/>
            <MetricCard title="Invoice to Customer"
              value={summary.totals[`invoice_to_customer${suffix}`]}
              colorClass="green" isCurrency={currency} icon={TrendingUp}/>
            <MetricCard title="ILIOS Margin"
              value={summary.totals[`ilios_margin${suffix}`]}
              subtitle="Invoice − ILIOS Spend"
              colorClass={summary.totals.ilios_margin >= 0 ? "teal" : "red"}
              isCurrency={currency}
              icon={summary.totals.ilios_margin >= 0 ? TrendingUp : TrendingDown}/>
          </div>

          {/* Trend Chart */}
          {summary.monthly_trend.length > 0 && (
            <div className="chart-card">
              <h2 className="chart-title">
                <BarChart2 size={16}/>
                Monthly Trend ({currency})
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={summary.monthly_trend} margin={{ top:10, right:20, left:10, bottom:5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                  <XAxis dataKey="month" tick={{ fontSize:11 }}/>
                  <YAxis tickFormatter={fmtK} tick={{ fontSize:11 }}/>
                  <Tooltip content={customTooltip}/>
                  <Legend/>
                  <Bar dataKey="cloud_service_cost" name="Cloud Cost" fill={COLORS.cloud_service_cost} stackId="c" radius={[0,0,0,0]}/>
                  <Bar dataKey="marketplace_cost" name="Marketplace" fill={COLORS.marketplace_cost} stackId="c" radius={[3,3,0,0]}/>
                  <Line type="monotone" dataKey={`ilios_spend${suffix}`} name="ILIOS Spend" stroke={COLORS.ilios_spend} strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey={`invoice_to_customer${suffix}`} name="Invoice" stroke={COLORS.invoice_to_customer} strokeWidth={2} dot={false}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Margin Chart */}
          {summary.monthly_trend.length > 0 && (
            <div className="chart-card">
              <h2 className="chart-title">
                <TrendingUp size={16}/>
                Monthly ILIOS Margin ({currency})
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={summary.monthly_trend} margin={{ top:10, right:20, left:10, bottom:5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                  <XAxis dataKey="month" tick={{ fontSize:11 }}/>
                  <YAxis tickFormatter={fmtK} tick={{ fontSize:11 }}/>
                  <Tooltip content={customTooltip}/>
                  <Bar dataKey={`ilios_margin${suffix}`} name="ILIOS Margin" fill={COLORS.ilios_margin} radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {summary.monthly_trend.length === 0 && (
            <div className="chart-card empty-chart">
              <BarChart2 size={32} className="empty-icon"/>
              <p>No data for the selected period.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
