# Restore needs the locked application runtime for authenticated business-field checks.
# This stage is not part of the ordinary backup target.
FROM python:3.12.13-slim-bookworm AS restore-python
WORKDIR /app
ENV UV_PYTHON_DOWNLOADS=never
RUN pip install --no-cache-dir uv==0.13.4
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

# Official PostgreSQL client/server version matches the deployed database.
FROM postgres:18.7-bookworm AS backup-base
# CVE-2026-109518 requires retries; disable them while obtaining signed Debian packages.
RUN apt-get -o Acquire::Retries=0 update && apt-get -o Acquire::Retries=0 install -y --no-install-recommends curl python3 python3-psycopg openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 backup-app && useradd --uid 10001 --gid 10001 --no-create-home backup-app
ARG TARGETARCH
# Upstream v1.3.2 release archive checksums (transfer integrity, not source hashes).
RUN case "$TARGETARCH" in \
      amd64) sum=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 ;; \
      arm64) sum=17f6d2b1821d7eed00bb99e52c0b33b8681fbde204d5e0fd4737ebd19a3dfda5 ;; \
      *) exit 1 ;; \
    esac \
    && curl --fail --location --proto '=https' --tlsv1.2 -o /tmp/age.tar.gz "https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-$TARGETARCH.tar.gz" \
    && echo "$sum  /tmp/age.tar.gz" | sha256sum --check - \
    && tar -xzf /tmp/age.tar.gz -C /tmp \
    && install -m 0755 /tmp/age/age /usr/local/bin/age \
    && rm -rf /tmp/age /tmp/age.tar.gz
WORKDIR /source
COPY infra ./infra
COPY Makefile .dockerignore .gitignore .node-version gmail-account-manager-spec.md ./
COPY frontend/public ./frontend/public
COPY frontend/openapi-ts.config.ts frontend/components.json ./frontend/
COPY scripts ./scripts
COPY backend/app ./backend/app
COPY backend/Dockerfile ./backend/Dockerfile
COPY frontend/src ./frontend/src
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json ./frontend/
COPY backend/alembic ./backend/alembic
COPY backend/alembic.ini backend/pyproject.toml backend/uv.lock ./backend/
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./frontend/
COPY docs ./docs
COPY README.md .env.example ./
USER 10001:10001
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["python3", "/source/scripts/backup_tool.py"]
CMD ["schedule", "--database", "gmail_manager", "--directory", "/backups", "--recipients", "/run/secrets/backup_recipients", "--at", "02:00"]

# One-shot, operator-run restore only. Decryption secrets are supplied at runtime,
# never baked into either image or mounted into the scheduled backup service.
FROM backup-base AS restore
USER 0:0
COPY --from=restore-python /usr/local /usr/local
COPY --from=restore-python /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}"
RUN ldconfig && python3 -c "import psycopg; from sys import path; path.insert(0, '/source/backend'); from app.ops.verify_restore import verify"
USER 10001:10001
CMD ["--help"]

# Only for the isolated PG18 application regression job, never a production service.
FROM restore AS test
USER 0:0
WORKDIR /source/backend
RUN uv sync --locked --no-install-project
COPY backend/tests ./tests
USER 10001:10001
ENTRYPOINT ["/source/backend/.venv/bin/python", "-m", "pytest"]
CMD ["-m", "integration"]

# Keep the default build contract: the last/default target remains backup-only.
FROM backup-base AS backup
