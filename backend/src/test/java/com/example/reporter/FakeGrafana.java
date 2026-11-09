package com.example.reporter;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** In-process Grafana stand-in: enforces the bearer token and renders a PNG of the requested size. */
public class FakeGrafana implements AutoCloseable {
    public static final String TOKEN = "glsa_test_token";
    public final HttpServer server;
    public final List<String> requests = new CopyOnWriteArrayList<>();
    public final List<String> authHeaders = new CopyOnWriteArrayList<>();
    public final AtomicInteger inflight = new AtomicInteger(), maxInflight = new AtomicInteger();

    public FakeGrafana() throws IOException { this(0); }

    public FakeGrafana(int port) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        // e2e helpers: inspect / clear what the report generator asked Grafana for
        server.createContext("/__requests", ex -> json(ex, 200, "[" + String.join(",", requests.stream().map(r -> "\"" + r.replace("\"", "%22") + "\"").toList()) + "]"));
        server.createContext("/__reset", ex -> { requests.clear(); maxInflight.set(0); json(ex, 200, "{}"); });
        server.createContext("/__stats", ex -> json(ex, 200, "{\"maxInflight\":" + maxInflight.get() + ",\"inflight\":" + inflight.get() + "}"));
        server.setExecutor(Executors.newCachedThreadPool());   // real Grafana serves requests concurrently
        server.createContext("/api/health", ex -> json(ex, 200, "{\"version\":\"10.4.0\",\"database\":\"ok\"}"));
        server.createContext("/api/org", ex -> { if (auth(ex)) json(ex, 200, "{\"id\":1,\"name\":\"Main Org.\"}"); });
        server.createContext("/api/search", ex -> {
            if (!auth(ex)) return;
            String q = Optional.ofNullable(ex.getRequestURI().getQuery()).orElse("");
            if (q.contains("query=tall")) { json(ex, 200, "[{\"uid\":\"tall\",\"title\":\"Tall Dashboard\",\"tags\":[]}]"); return; }
            boolean filter = q.contains("query=cpu");
            json(ex, 200, filter
                ? "[{\"uid\":\"abc\",\"title\":\"CPU Overview\",\"folderTitle\":\"Infra\",\"tags\":[\"linux\"]}]"
                : "[{\"uid\":\"abc\",\"title\":\"CPU Overview\",\"folderTitle\":\"Infra\",\"tags\":[\"linux\"]},{\"uid\":\"norender\",\"title\":\"No Renderer\",\"tags\":[]}]");
        });
        server.createContext("/api/dashboards/uid/", ex -> {
            if (!auth(ex)) return;
            String uid = ex.getRequestURI().getPath().substring("/api/dashboards/uid/".length());
            if (uid.equals("tall")) {            // 40 panels, 20 grid rows of 8 -> far taller than one page
                StringBuilder ps = new StringBuilder();
                for (int i = 0; i < 40; i++) ps.append(i > 0 ? "," : "").append("{\"id\":").append(i + 1).append(",\"title\":\"Panel ").append(i + 1)
                    .append("\",\"type\":\"timeseries\",\"gridPos\":{\"x\":").append((i % 2) * 12).append(",\"y\":").append((i / 2) * 8).append(",\"w\":12,\"h\":8}}");
                json(ex, 200, "{\"meta\":{\"url\":\"/d/tall/tall\"},\"dashboard\":{\"title\":\"Tall Dashboard\",\"templating\":{\"list\":[{\"name\":\"host\",\"type\":\"query\",\"current\":{\"value\":\"srv-default\"}}]},\"panels\":[" + ps + "]}}");
                return;
            }
            if (uid.equals("missing")) { json(ex, 404, "{\"message\":\"Dashboard not found\"}"); return; }
            json(ex, 200, "{\"meta\":{\"url\":\"/d/" + uid + "/cpu-overview\"},\"dashboard\":{\"title\":\"CPU Overview\"," +
                "\"templating\":{\"list\":[{\"name\":\"host\",\"label\":\"Host\",\"type\":\"query\",\"current\":{\"value\":\"srv-default\"},\"options\":[{\"value\":\"srv-default\"},{\"value\":\"web-01\"},{\"value\":\"db-02\"}]}," +
                "{\"name\":\"ds\",\"type\":\"datasource\",\"current\":{\"value\":\"prom\"}}," +
                "{\"name\":\"job\",\"type\":\"custom\",\"current\":{\"value\":[\"$__all\"]},\"options\":[{\"value\":\"$__all\"},{\"value\":\"node\"},{\"value\":\"app\"}]}]},\"panels\":[" +
                "{\"id\":1,\"title\":\"CPU usage\",\"type\":\"timeseries\",\"gridPos\":{\"x\":0,\"y\":0,\"w\":12,\"h\":8}}," +
                "{\"id\":2,\"title\":\"Memory\",\"type\":\"gauge\",\"gridPos\":{\"x\":12,\"y\":0,\"w\":6,\"h\":6}}," +
                "{\"type\":\"row\",\"title\":\"Collapsed\",\"panels\":[{\"id\":3,\"title\":\"Disk\",\"type\":\"bargauge\",\"gridPos\":{\"x\":0,\"y\":8,\"w\":12,\"h\":8}}]}]}}");
        });
        server.createContext("/render/d-solo/", ex -> {
            requests.add(ex.getRequestURI().toString());
            if (!auth(ex)) return;
            String path = ex.getRequestURI().getPath();
            if (path.contains("/norender/")) { bytes(ex, 200, "text/html", "<html>login</html>".getBytes(StandardCharsets.UTF_8)); return; }
            if (path.contains("/boom/")) { json(ex, 500, "{\"message\":\"boom\"}"); return; }
            int now = inflight.incrementAndGet();
            maxInflight.accumulateAndGet(now, Math::max);
            try {
                if (path.contains("/slow/")) { try { Thread.sleep(700); } catch (InterruptedException ignored) { } }   // slow renderer
                renderOk(ex);
            } finally { inflight.decrementAndGet(); }
        });
        server.start();
    }

    private void renderOk(HttpExchange ex) throws IOException {
        {
            Map<String, String> q = query(ex.getRequestURI().getRawQuery());
            int w = Integer.parseInt(q.getOrDefault("width", "100")), h = Integer.parseInt(q.getOrDefault("height", "100"));
            bytes(ex, 200, "image/png", png(w, h, "panel " + q.get("panelId")));
        }
    }

    public String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
    public static Map<String, String> query(String raw) {
        Map<String, String> m = new LinkedHashMap<>();
        if (raw == null) return m;
        for (String kv : raw.split("&")) {
            int i = kv.indexOf('=');
            m.put(java.net.URLDecoder.decode(kv.substring(0, i), StandardCharsets.UTF_8), java.net.URLDecoder.decode(kv.substring(i + 1), StandardCharsets.UTF_8));
        }
        return m;
    }

    private boolean auth(HttpExchange ex) throws IOException {
        String a = ex.getRequestHeaders().getFirst("Authorization");
        authHeaders.add(String.valueOf(a));
        if (("Bearer " + TOKEN).equals(a)) return true;
        json(ex, 401, "{\"message\":\"Unauthorized\"}");
        return false;
    }
    private static void json(HttpExchange ex, int code, String body) throws IOException { bytes(ex, code, "application/json", body.getBytes(StandardCharsets.UTF_8)); }
    private static void bytes(HttpExchange ex, int code, String type, byte[] b) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.sendResponseHeaders(code, b.length);
        ex.getResponseBody().write(b);
        ex.close();
    }

    public static byte[] png(int w, int h, String label) {
        System.setProperty("java.awt.headless", "true");
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setPaint(new GradientPaint(0, 0, new Color(0x1F77B4), w, h, new Color(0xFF7F0E)));
        g.fillRect(0, 0, w, h);
        g.setColor(Color.WHITE); g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, Math.max(12, h / 8)));
        g.drawString(label + " " + w + "x" + h, 10, h / 2);
        g.dispose();
        try (ByteArrayOutputStream o = new ByteArrayOutputStream()) { ImageIO.write(img, "png", o); return o.toByteArray(); }
        catch (IOException e) { throw new RuntimeException(e); }
    }

    @Override public void close() { server.stop(0); }

    /** Standalone mode for the browser e2e tests. */
    public static void main(String[] args) throws Exception {
        FakeGrafana g = new FakeGrafana(args.length > 0 ? Integer.parseInt(args[0]) : 0);
        System.out.println("FAKE_GRAFANA " + g.url());
        Thread.currentThread().join();
    }
}
