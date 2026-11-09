#!/usr/bin/env bash
# Backend (JUnit) + frontend unit (Vitest) + browser e2e (Playwright, real backend + fake Grafana)
set -euo pipefail
cd "$(dirname "$0")/.."
(cd backend && mvn -B test && mvn -q -B package -DskipTests && mvn -q -B dependency:build-classpath -Dmdep.outputFile=target/cp.txt)
(cd frontend && npx tsc --noEmit && npx vitest run && npx playwright test)
