COMPOSE = docker compose --env-file .env -f infra/docker-compose.yml
DEV_COMPOSE = $(COMPOSE) -f infra/docker-compose.dev.yml

.PHONY: install generate-api check test test-db dev-api dev-web compose-check up-dev
install:
	cd backend && uv sync --locked
	cd frontend && pnpm install --frozen-lockfile

generate-api:
	cd frontend && pnpm generate:api

check:
	cd backend && uv run --locked ruff check . ../scripts ../infra/backup && uv run --locked ruff format --check . ../scripts ../infra/backup
	cd frontend && pnpm typecheck && pnpm format:check && pnpm build

test:
	cd backend && uv run --locked pytest -m 'not integration'
	cd frontend && pnpm test

test-db:
	cd backend && uv run --locked pytest -m integration

dev-api:
	cd backend && uv run --locked uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers

dev-web:
	cd frontend && pnpm dev

compose-check:
	$(DEV_COMPOSE) config --quiet

# Compose 按数据库健康 → 迁移成功 → API 的依赖关系启动。
up-dev:
	$(DEV_COMPOSE) up -d --build --wait api
