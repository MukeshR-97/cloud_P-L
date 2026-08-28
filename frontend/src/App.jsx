import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import RecordList from "./pages/RecordList";
import RecordForm from "./pages/RecordForm";
import AwsAccounts from "./pages/AwsAccounts";
import "./App.css";

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Navbar />
        <main>
          <Routes>
            <Route path="/"              element={<Dashboard />} />
            <Route path="/records"       element={<RecordList />} />
            <Route path="/records/new"   element={<RecordForm />} />
            <Route path="/records/:id/edit" element={<RecordForm />} />
            <Route path="/aws-accounts"  element={<AwsAccounts />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    </ToastProvider>
  );
}
