import React from "react";
import { Link, useLocation } from "react-router-dom";
import "./Navbar.css";

export default function Navbar() {
  const { pathname } = useLocation();

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        ☁️ <span>Cloud P&amp;L Dashboard</span>
      </div>
      <ul className="navbar-links">
        <li>
          <Link to="/" className={pathname === "/" ? "active" : ""}>
            Dashboard
          </Link>
        </li>
        <li>
          <Link to="/records" className={pathname.startsWith("/records") ? "active" : ""}>
            Records
          </Link>
        </li>
        <li>
          <Link to="/records/new" className={pathname === "/records/new" ? "active" : ""}>
            + New Entry
          </Link>
        </li>
        <li>
          <Link to="/aws-accounts" className={pathname.startsWith("/aws-accounts") ? "active" : ""}>
            ☁ AWS Accounts
          </Link>
        </li>
      </ul>
    </nav>
  );
}
