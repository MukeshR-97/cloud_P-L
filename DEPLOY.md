# Deploy to AWS EC2 with Docker

## Prerequisites on EC2

Launch an EC2 instance (Ubuntu 22.04 recommended, t3.small or larger).
Open these ports in the Security Group:
- **22**   — SSH
- **6000** — Backend API
- **5173** — Frontend

SSH into your instance:
```bash
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

---

## Step 1 — Install Docker on EC2

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ubuntu
# Log out and back in for group to take effect
exit
ssh -i your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

---

## Step 2 — Copy project files to EC2

From your Windows machine, use SCP:

```cmd
scp -i your-key.pem -r "d:\Ticketing Tool\cloud_P&L" ubuntu@<EC2-PUBLIC-IP>:~/cloud_pnl
```

Or use Git:
```bash
# On EC2
git clone <your-repo-url> ~/cloud_pnl
```

---

## Step 3 — Configure environment

```bash
cd ~/cloud_pnl

# Create the docker .env file with your EC2 public IP
cat > .env << EOF
VITE_API_URL=http://13.234.225.35:6000/api
EOF

# Edit backend .env — update DB_HOST to your RDS/MySQL endpoint
nano backend/.env
```

Your `backend/.env` should look like:
```
DB_HOST=your-rds-endpoint.rds.amazonaws.com   # or 3.111.191.71
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=cloud_pnl
SECRET_KEY=change_me_in_production
FERNET_KEY=your_existing_fernet_key
```

---

## Step 4 — Build and run

```bash
cd ~/cloud_pnl

# Build and start both containers
docker compose up -d --build

# Check they're running
docker compose ps

# View logs
docker compose logs -f
```

---

## Step 5 — Initialize the database (first time only)

```bash
# Run the SQL init script against your MySQL
mysql -h 3.111.191.71 -u root -p cloud_pnl < backend/init_db.sql

# Or run migration script inside the backend container
docker compose exec backend python migrate.py
```

---

## Access the app

| Service  | URL |
|---|---|
| Frontend | `http://<EC2-PUBLIC-IP>:5173` |
| Backend API | `http://<EC2-PUBLIC-IP>:8000/api/records` |

---

## Useful commands

```bash
# Stop
docker compose down

# Restart after code change
docker compose up -d --build

# View backend logs
docker compose logs -f backend

# View frontend logs
docker compose logs -f frontend

# Enter backend shell
docker compose exec backend bash
```

---

## Update deployment (after code change)

```bash
cd ~/cloud_pnl
git pull   # or re-copy files
docker compose up -d --build
```

---

## Notes

- The MySQL DB is **not** in Docker — it stays at `3.111.191.71` (your existing server).
- The `FERNET_KEY` in `backend/.env` must be the same key used when credentials were originally encrypted. Never change it.
- For HTTPS, put an Nginx or ALB in front and proxy to ports 6000/5173.
