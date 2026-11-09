import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'

const backend = '../backend'
const cp = readFileSync(`${backend}/target/cp.txt`, 'utf8').trim()
const E2E_DATA = '/tmp/reporter-e2e-data'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,                    // tests share one backend (settings / templates / blocks)
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1700, height: 1000 },
    launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } as Record<string, string> },
    acceptDownloads: true,
    trace: 'off',
  },
  webServer: [
    { command: `java -cp ${backend}/target/test-classes:${backend}/target/classes:${cp} com.example.reporter.FakeGrafana 3100`, url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: `rm -rf ${E2E_DATA} && java -jar ${backend}/target/grafana-reporter-1.0.0.jar`, url: 'http://127.0.0.1:8090/api/settings', reuseExistingServer: true, timeout: 90_000,
      env: { PORT: '8090', DATA_DIR: E2E_DATA } },
    { command: 'npx vite --port 5173 --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000,
      env: { API_URL: 'http://127.0.0.1:8090' } },
  ],
})
