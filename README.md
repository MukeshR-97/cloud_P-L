# Cloud P&L Cost Dashboard

A full-stack cost dashboard with Python (Flask) backend, React frontend, and MySQL database.

---

## Formulas

| Metric | Formula |
|---|---|
| **Total Consumption** | Cloud Service Cost + Marketplace Cost |
| **ILIOS Spend** | Total − Distributor Discount − Credit Amount − Managed Services − Customer Discount − Redington Credit Note |
| **Invoice to Customer** | Total − Customer Discount + Managed Services |
| **ILIOS Margin** | Invoice to Customer − ILIOS Spend |

> Distributor Discount and Credit Amount are applied against **cloud service cost only** (not marketplace) for ILIOS Spend calculation.

---

## Setup

### 1. MySQL Database
```sql
-- Run init_db.sql in your MySQL client
mysql -u root -p < backend/init_db.sql
```

### 2. Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Edit .env with your DB credentials
copy .env .env.local            # optional

python run.py                  # starts on http://localhost:5000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                    # starts on http://localhost:5173
```

---

## API Endpoints

| Method | URL | Description |
|---|---|---|
| GET | /api/records | List all records (supports `from_date`, `to_date` params) |
| POST | /api/records | Create a record |
| GET | /api/records/:id | Get a single record |
| PUT | /api/records/:id | Update a record |
| DELETE | /api/records/:id | Delete a record |
| GET | /api/dashboard/summary | Dashboard aggregates + monthly trend |

---

## Project Structure

```
cloud_P&L/
├── backend/
│   ├── app/
│   │   ├── __init__.py      Flask app factory
│   │   ├── models.py        CostRecord model + computed properties
│   │   └── routes.py        REST API endpoints
│   ├── .env                 DB credentials (edit this)
│   ├── init_db.sql          MySQL setup script
│   ├── requirements.txt
│   └── run.py
└── frontend/
    └── src/
        ├── api.js            Axios client
        ├── App.jsx           Router
        ├── components/       Navbar, MetricCard
        ├── pages/            Dashboard, RecordList, RecordForm
        └── utils/format.js   Currency formatting helpers
```
