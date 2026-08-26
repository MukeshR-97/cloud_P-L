export function formatCurrency(value, decimals = 2) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

export function formatINR(value, decimals = 2) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPct(value, decimals = 2) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(decimals)}%`;
}

export function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value);
}

export function signClass(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}
