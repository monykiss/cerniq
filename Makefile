.PHONY: dev dev-docker build build-backend build-frontend migrate migrate-dev db-studio test test-frontend test-parser lint health clean

# ─── Development ───────────────────────────────
dev:
	docker compose up -d postgres redis
	cd backend-node && npm run start:dev &
	cd frontend && npm run dev

dev-docker:
	docker compose up --build

# ─── Build ─────────────────────────────────────
build-backend:
	cd backend-node && npm ci && npx prisma generate && npm run build

build-frontend:
	cd frontend && npm ci && npm run build

build: build-backend build-frontend

# ─── Database (local) ──────────────────────────
migrate:
	cd backend-node && npx prisma migrate deploy

migrate-dev:
	cd backend-node && npx prisma migrate dev

db-studio:
	cd backend-node && npx prisma studio

# ─── Test & lint ───────────────────────────────
test:
	cd backend-node && npm test

test-frontend:
	cd frontend && npm test

test-parser:
	cd services/cossec-parser && python -m pytest -q

lint:
	cd backend-node && npm run lint
	cd frontend && npm run lint

# ─── Health (local) ────────────────────────────
health:
	@curl -sf http://localhost:3000/health | python3 -m json.tool || echo "Backend not running"

# ─── Clean ─────────────────────────────────────
clean:
	rm -rf backend-node/dist backend-node/node_modules frontend/.next frontend/node_modules
