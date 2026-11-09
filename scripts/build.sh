#!/usr/bin/env bash
# Builds the React UI, embeds it into the Spring Boot jar -> backend/target/grafana-reporter.jar
set -euo pipefail
cd "$(dirname "$0")/.."
(cd frontend && npm ci --no-audit --no-fund && npm run build)
rm -rf backend/src/main/resources/static && mkdir -p backend/src/main/resources/static
cp -r frontend/dist/* backend/src/main/resources/static/
(cd backend && mvn -q -B package -DskipTests)
echo "OK: backend/target/grafana-reporter.jar"
