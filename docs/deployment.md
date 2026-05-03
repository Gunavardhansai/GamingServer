# Deployment Guide

## Local Without Docker

Start only the Node.js service:

```powershell
npm install
npm run prisma:generate
npm run dev
```

`/health` works without Postgres. Room and game APIs require PostgreSQL.

## Local With Docker

Run the full stack:

```powershell
docker compose up --build
```

Then open:

```text
http://localhost:3000/health
http://localhost:3000/ready
```

The app container runs `prisma migrate deploy` before starting.

## Production

Recommended production targets:

- AWS ECS or EKS with AWS ALB
- Render Docker service plus managed PostgreSQL and Redis
- Fly.io machines with managed PostgreSQL and Redis
- Kubernetes with NGINX or cloud ingress

Production checklist:

- Set `DATABASE_URL` to managed PostgreSQL.
- Set `REDIS_URL` to managed Redis.
- Enable WebSocket upgrades on the load balancer.
- Use sticky sessions if Socket.IO polling is enabled.
- Run at least two app instances for availability.
- Run migrations during deploy with `npm run prisma:deploy`.
- Keep `/health` and `/ready` wired to load balancer checks.

Vercel is not recommended for this backend because long-lived WebSocket game sessions need persistent server processes.
