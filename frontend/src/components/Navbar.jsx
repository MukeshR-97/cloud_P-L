import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, FileText, Cloud } from "lucide-react";
import "./Navbar.css";

const NAV = [
  { to: "/",             label: "Dashboard",    Icon: LayoutDashboard, exact: true  },
  { to: "/records",      label: "Records",      Icon: FileText,        exact: false },
  { to: "/aws-accounts", label: "AWS Accounts", Icon: Cloud,           exact: false },
];

export default function Navbar() {
  const { pathname } = useLocation();

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Cloud size={20} strokeWidth={2.5} className="brand-icon" />
        <span>Cloud P&amp;L</span>
      </div>
      <ul className="navbar-links">
        {NAV.map(({ to, label, Icon, exact }) => {
          const active = exact ? pathname === to : pathname.startsWith(to) && to !== "/";
          const isExactHome = to === "/" && pathname === "/";
          return (
            <li key={to}>
              <Link to={to} className={`nav-link ${active || isExactHome ? "active" : ""}`}>
                <Icon size={15} strokeWidth={2} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
