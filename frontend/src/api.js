import axios from "axios";

// In production (Docker/EC2) VITE_API_URL is injected at build time.
// Locally it falls back to localhost:6000.
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:6000/api";

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

export const getRecords = (params = {}) => api.get("/records", { params });
export const getRecord  = (id)          => api.get(`/records/${id}`);
export const createRecord = (data)      => api.post("/records", data);
export const updateRecord = (id, data)  => api.put(`/records/${id}`, data);
export const deleteRecord = (id)        => api.delete(`/records/${id}`);
export const getDashboardSummary = (params = {}) =>
  api.get("/dashboard/summary", { params });

/** Apply discount %s to all records of an account in one shot */
export const bulkUpdateDiscounts = (data) =>
  api.post("/records/bulk-update-discounts", data);

// ── AWS Accounts ────────────────────────────────────────────────────────────
export const getAwsAccounts    = ()        => api.get("/aws-accounts");
export const getAwsAccount     = (id)      => api.get(`/aws-accounts/${id}`);
export const createAwsAccount  = (data)    => api.post("/aws-accounts", data);
export const updateAwsAccount  = (id, data)=> api.put(`/aws-accounts/${id}`, data);
export const deleteAwsAccount  = (id)      => api.delete(`/aws-accounts/${id}`);
export const fetchAwsCosts     = (id)      => api.post(`/aws-accounts/${id}/fetch`);
export const listChildAccounts = (parentId)=> api.get(`/aws-accounts/${parentId}/list-children`);
export const addChildAccount   = (parentId, data) =>
  api.post(`/aws-accounts/${parentId}/add-child`, data);

export default api;
