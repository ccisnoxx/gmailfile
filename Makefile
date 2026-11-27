COMPOSE = docker compose --env-file .env -f infra/docker-compose.yml
DEV_COMPOSE = $(COMPOSE) -f infra/docker-compose.dev.yml

.PHONY: install generate-api check test test-db dev-api dev-web compose-check up-dev \
	check-openapi check-docs compose-check-all check-nginx scan-dist \
	audit-deps audit-deps-offline-integrity audit-deps-online-strict \
	test-cov test-cov-db test-e2e test-e2e-live test-a11y test-compat bench-csv \
	gate-release gate-release-live gate-release-full
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

test-cov:
	cd backend && uv run --locked python ../scripts/check-coverage.py --min-total 55 --min-core 50 -- -m 'not integration'

test-cov-db:
	cd backend && uv run --locked python ../scripts/check-coverage.py --min-total 85 --min-core 90

test-e2e:
	cd frontend && pnpm test:e2e

test-e2e-live:
	cd backend && uv run --locked python ../scripts/run-live-e2e.py

test-a11y:
	cd frontend && pnpm exec playwright test e2e/macos-keyboard-a11y.spec.ts e2e/wave4-a11y-compat.spec.ts --project=chromium

test-compat:
	cd frontend && pnpm exec playwright test e2e/wave4-a11y-compat.spec.ts --project=chromium --project=firefox --project=webkit

bench-csv:
	cd backend && uv run --locked python ../scripts/bench-csv-perf.py

check-openapi:
	cd backend && uv run --locked python ../scripts/check-release-gates.py check-openapi

check-docs:
	cd backend && uv run --locked python ../scripts/check-release-gates.py check-docs

compose-check-all:
	cd backend && uv run --locked python ../scripts/check-release-gates.py compose-all

check-nginx:
	cd backend && uv run --locked python ../scripts/check-release-gates.py nginx

scan-dist:
	cd backend && uv run --locked python ../scripts/check-release-gates.py scan-dist

audit-deps-offline-integrity:
	cd backend && uv run --locked python ../scripts/check-release-gates.py audit-deps-offline-integrity

audit-deps-online-strict:
	cd backend && uv run --locked python ../scripts/check-release-gates.py audit-deps-online-strict

audit-deps: audit-deps-offline-integrity

gate-release: check check-openapi check-docs compose-check-all check-nginx scan-dist audit-deps-offline-integrity test test-cov

# 本地快速真实全栈验证门禁（不含跨浏览器/无障碍矩阵与强制在线漏洞库审计）
gate-release-live: gate-release test-db test-cov-db test-e2e-live

# 私有发布机完整严格发布门禁（含强制在线漏洞库审计、PG18 集成与覆盖率、模拟 E2E、无障碍、三引擎兼容与实时全栈 E2E）
gate-release-full: gate-release audit-deps-online-strict test-db test-cov-db test-e2e test-a11y test-compat test-e2e-live

dev-api:
	cd backend && uv run --locked uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers

dev-web:
	cd frontend && pnpm dev

compose-check:
	$(DEV_COMPOSE) config --quiet

# Compose 按数据库健康 → 迁移成功 → API 的依赖关系启动。
up-dev:
	$(DEV_COMPOSE) up -d --build --wait api
