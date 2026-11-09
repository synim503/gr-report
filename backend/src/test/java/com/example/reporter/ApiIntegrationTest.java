package com.example.reporter;

import com.example.reporter.model.Template;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

import static com.example.reporter.TestUtil.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ApiIntegrationTest {
    static FakeGrafana grafana;
    static java.nio.file.Path dataDir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        grafana = new FakeGrafana();
        dataDir = Files.createTempDirectory("reporter-test");
        r.add("app.data-dir", () -> dataDir.toString());
    }
    @AfterAll static void stop() { grafana.close(); }

    @Autowired TestRestTemplate rest;
    @LocalServerPort int port;

    @SuppressWarnings("unchecked")
    Map<String, Object> map(ResponseEntity<Map> r) { return r.getBody(); }

    void configure() {
        rest.put("/api/settings", Map.of("grafanaUrl", grafana.url() + "/", "token", FakeGrafana.TOKEN));
    }

    @Test @Order(1) void browsingBeforeConfigurationGivesClearError() {
        var r = rest.getForEntity("/api/grafana/dashboards", Map.class);
        assertEquals(HttpStatus.PRECONDITION_FAILED, r.getStatusCode());
        assertTrue(map(r).get("message").toString().contains("not configured"));
    }

    @Test @Order(2) void settingsNeverExposeTheToken() {
        configure();
        var r = rest.getForEntity("/api/settings", String.class);
        assertFalse(r.getBody().contains(FakeGrafana.TOKEN));
        assertTrue(r.getBody().contains("\"tokenSet\":true"));
        assertTrue(r.getBody().contains("\"grafanaUrl\":\"" + grafana.url() + "\""), "trailing slash normalised");
        assertTrue(r.getBody().contains("••••oken"), r.getBody());
    }

    @Test @Order(3) void settingsPersistedToDisk() throws Exception {
        assertTrue(Files.readString(dataDir.resolve("settings.json")).contains(FakeGrafana.TOKEN));
    }

    @Test @Order(4) void invalidSettingsAreRejected() {
        var h = new HttpHeaders(); h.setContentType(MediaType.APPLICATION_JSON);
        assertEquals(HttpStatus.BAD_REQUEST, rest.exchange("/api/settings", HttpMethod.PUT, new HttpEntity<>("{\"grafanaUrl\":\"ftp://x\"}", h), Map.class).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, rest.exchange("/api/settings", HttpMethod.PUT, new HttpEntity<>("{\"imageScale\":99}", h), Map.class).getStatusCode());
    }

    @Test @Order(5) void connectionTestSavedAndAdHoc() {
        configure();
        var ok = map(rest.postForEntity("/api/grafana/test", Map.of(), Map.class));
        assertEquals(true, ok.get("ok")); assertEquals("Main Org.", ok.get("org"));
        var bad = map(rest.postForEntity("/api/grafana/test", Map.of("grafanaUrl", grafana.url(), "token", "nope"), Map.class));
        assertEquals(false, bad.get("ok"));
        assertTrue(bad.get("message").toString().contains("Token rejected"));
        assertEquals(true, map(rest.postForEntity("/api/grafana/test", Map.of(), Map.class)).get("ok"), "ad-hoc test must not overwrite saved settings");
    }

    @Test @Order(6) void dashboardsAndPanels() {
        configure();
        var list = rest.getForEntity("/api/grafana/dashboards?query=cpu", List.class);
        assertEquals(1, list.getBody().size());
        var d = map(rest.getForEntity("/api/grafana/dashboards/abc", Map.class));
        assertEquals(3, ((List<?>) d.get("panels")).size());
        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/grafana/dashboards/missing", Map.class).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, rest.getForEntity("/api/grafana/dashboards/a%20b", Map.class).getStatusCode());
    }

    @Test @Order(7) void panelImagePreviewProxiesWithToken() throws Exception {
        configure();
        var r = rest.getForEntity("/api/grafana/panel-image?uid=abc&panelId=1&width=300&height=150&from=now-1d&to=now&var-host=h1", byte[].class);
        assertEquals(MediaType.IMAGE_PNG, r.getHeaders().getContentType());
        var img = ImageIO.read(new ByteArrayInputStream(r.getBody()));
        assertEquals(300, img.getWidth());
        assertTrue(grafana.requests.stream().anyMatch(q -> q.contains("var-host=h1") && q.contains("from=now-1d")));
    }

    @Test @Order(8) void panelImageValidatesInput() {
        configure();
        assertEquals(HttpStatus.BAD_REQUEST, rest.getForEntity("/api/grafana/panel-image?uid=abc&panelId=1&from=bad value", String.class).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, rest.getForEntity("/api/grafana/panel-image?uid=../x&panelId=1", String.class).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, rest.getForEntity("/api/grafana/panel-image?uid=abc&panelId=1&theme=pink", String.class).getStatusCode());
    }

    @Test @Order(9) void templateCrud() {
        Template t = template(text("<p>x</p>", 1, 2, 30, 40)); t.name = "My report";
        var created = rest.postForEntity("/api/templates", t, Template.class).getBody();
        assertNotNull(created.id); assertNotNull(created.updatedAt);
        assertEquals("<p>x</p>", rest.getForObject("/api/templates/" + created.id, Template.class).pages.get(0).elements.get(0).html);
        created.name = "Renamed";
        rest.put("/api/templates/" + created.id, created);
        assertEquals("Renamed", rest.getForObject("/api/templates/" + created.id, Template.class).name);
        assertTrue(rest.getForObject("/api/templates", List.class).stream().anyMatch(o -> ((Map<?, ?>) o).get("name").equals("Renamed")));
        rest.delete("/api/templates/" + created.id);
        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/templates/" + created.id, Template.class).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND, rest.exchange("/api/templates/" + created.id, HttpMethod.PUT, new HttpEntity<>(created), Template.class).getStatusCode());
    }

    @Test @Order(10) void templatesRejectPathTraversalAndInvalidBodies() {
        assertTrue(rest.getForEntity("/api/templates/..%2Fsettings", String.class).getStatusCode().is4xxClientError());
        Template t = template(); t.pages.clear();
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/templates", t, Map.class).getStatusCode());
        Template w = template(text("<p/>", 0, 0, 10, 10)); w.pageWidth = 5;
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/templates", w, Map.class).getStatusCode());
        Template c = template(chart("bad uid!", 1, 0, 0, 10, 10));
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/reports/generate", c, Map.class).getStatusCode());
        Template tr = template(text("<p/>", 0, 0, 10, 10)); tr.timeRange.from = "now; rm";
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/reports/generate", tr, Map.class).getStatusCode());
    }

    @Test @Order(11) void generateProducesDocxWithChartsAtRequestedSizeAndTimeRange() throws Exception {
        configure(); grafana.requests.clear();
        var t = template(text("<h1>Report {{date}}</h1>", 40, 30, 500, 40), chart("abc", 1, 40, 100, 300, 150), chart("abc", 2, 360, 100, 190, 150));
        t.name = "Отчёт Q1";
        t.timeRange.from = "now-7d"; t.pages.get(0).elements.get(2).chart.from = "now-1h";
        t.pages.get(0).elements.get(1).chart.vars.put("host", "srv1");
        var r = rest.postForEntity("/api/reports/generate", t, byte[].class);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals(Controllers_DOCX, r.getHeaders().getContentType().toString());
        assertTrue(URLDecoder.decode(r.getHeaders().getContentDisposition().toString(), StandardCharsets.UTF_8).contains("Отчёт Q1.docx"), r.getHeaders().getContentDisposition().toString());
        assertEquals("", URLDecoder.decode(r.getHeaders().getFirst("X-Report-Warnings"), StandardCharsets.UTF_8));
        var d = new XWPFDocument(new ByteArrayInputStream(r.getBody()));
        assertEquals(2, d.getAllPictures().size());
        assertTrue(d.getParagraphs().stream().anyMatch(p -> p.getText().startsWith("Report 20")));
        // renders requested with 1.5x of pixel size: 300pt*96/72*1.5 = 600
        var reqs = grafana.requests.stream().map(q -> FakeGrafana.query(q.substring(q.indexOf('?') + 1))).toList();
        var p1 = reqs.stream().filter(q -> q.get("panelId").equals("1")).findFirst().get();
        var p2 = reqs.stream().filter(q -> q.get("panelId").equals("2")).findFirst().get();
        assertEquals("600", p1.get("width")); assertEquals("300", p1.get("height"));
        assertEquals("now-7d", p1.get("from")); assertEquals("now-1h", p2.get("from"));
        assertEquals("srv1", p1.get("var-host"));
    }
    static final String Controllers_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    @Test @Order(12) void failingChartGetsPlaceholderAndWarningUnlessStrict() throws Exception {
        configure();
        var t = template(chart("boom", 1, 10, 10, 200, 100), chart("abc", 1, 10, 150, 200, 100));
        var r = rest.postForEntity("/api/reports/generate", t, byte[].class);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertTrue(URLDecoder.decode(r.getHeaders().getFirst("X-Report-Warnings"), StandardCharsets.UTF_8).contains("P1"));
        assertEquals(2, new XWPFDocument(new ByteArrayInputStream(r.getBody())).getAllPictures().size());
        var strict = rest.postForEntity("/api/reports/generate?strict=true", t, Map.class);
        assertEquals(HttpStatus.BAD_GATEWAY, strict.getStatusCode());
    }

    @Test @Order(13) void generateWithWrongTokenInStrictModeSurfacesAuthError() {
        rest.put("/api/settings", Map.of("token", "revoked"));
        var t = template(chart("abc", 1, 10, 10, 200, 100));
        var r = rest.postForEntity("/api/reports/generate?strict=true", t, Map.class);
        assertEquals(HttpStatus.BAD_GATEWAY, r.getStatusCode());
        assertTrue(r.getBody().get("message").toString().contains("token"));
        configure();
    }

    @Test @Order(14) void imageElementsAreEmbeddedAndBadOnesSkippedWithWarning() throws Exception {
        String b64 = Base64.getEncoder().encodeToString(FakeGrafana.png(20, 20, "i"));
        Template.Element img = new Template.Element(); img.type = Template.Type.image; img.x = 10; img.y = 10; img.w = 50; img.h = 50; img.dataUrl = "data:image/png;base64," + b64;
        Template.Element bad = new Template.Element(); bad.type = Template.Type.image; bad.w = 10; bad.h = 10; bad.dataUrl = "data:image/svg+xml;base64,AAAA";
        var r = rest.postForEntity("/api/reports/generate", template(img, bad), byte[].class);
        assertEquals(1, new XWPFDocument(new ByteArrayInputStream(r.getBody())).getAllPictures().size());
        assertTrue(URLDecoder.decode(r.getHeaders().getFirst("X-Report-Warnings"), StandardCharsets.UTF_8).contains("skipped"));
    }

    @Test @Order(15) void generateFromSavedTemplate() throws Exception {
        configure();
        var saved = rest.postForEntity("/api/templates", template(text("<p>saved</p>", 5, 5, 100, 30), chart("abc", 3, 5, 50, 200, 100)), Template.class).getBody();
        var r = rest.postForEntity("/api/templates/" + saved.id + "/generate", null, byte[].class);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertEquals(1, new XWPFDocument(new ByteArrayInputStream(r.getBody())).getAllPictures().size());
        assertEquals(HttpStatus.NOT_FOUND, rest.postForEntity("/api/templates/nope/generate", null, Map.class).getStatusCode());
    }

    // ---------- blocks (predefined chart groups with variables) ----------

    @Test @Order(16) void blockFromDashboardCarriesLayoutAndVariables() {
        configure();
        var b = rest.getForObject("/api/grafana/dashboards/abc/block?width=480", Map.class);
        assertEquals("abc", b.get("dashboardUid"));
        assertEquals(3, ((List<?>) b.get("charts")).size());
        var vars = (List<Map<String, Object>>) b.get("variables");
        assertEquals("host", vars.get(0).get("name")); assertEquals("srv-default", vars.get(0).get("defaultValue"));
        assertEquals(HttpStatus.BAD_REQUEST, rest.getForEntity("/api/grafana/dashboards/abc/block?width=5", Map.class).getStatusCode());
    }

    @Test @Order(17) void blockCrudAndValidation() {
        configure();
        var b = rest.getForObject("/api/grafana/dashboards/abc/block", Map.class);
        b.put("name", "Linux utilisation");
        var created = rest.postForEntity("/api/blocks", b, Map.class).getBody();
        String id = (String) created.get("id"); assertNotNull(id);
        assertTrue(rest.getForObject("/api/blocks", List.class).stream().anyMatch(o -> ((Map<?, ?>) o).get("id").equals(id)));
        b.put("name", "Renamed"); rest.put("/api/blocks/" + id, b);
        assertTrue(rest.getForObject("/api/blocks", List.class).stream().anyMatch(o -> "Renamed".equals(((Map<?, ?>) o).get("name"))));
        rest.delete("/api/blocks/" + id);
        assertFalse(rest.getForObject("/api/blocks", List.class).stream().anyMatch(o -> ((Map<?, ?>) o).get("id").equals(id)));
        assertEquals(HttpStatus.NOT_FOUND, rest.exchange("/api/blocks/" + id, HttpMethod.DELETE, null, Void.class).getStatusCode());

        var bad = new HashMap<>(b); bad.put("charts", List.of());
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/blocks", bad, Map.class).getStatusCode());
        var badVar = new HashMap<>(b); badVar.put("variables", List.of(Map.of("name", "bad name!", "defaultValue", "x")));
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/blocks", badVar, Map.class).getStatusCode());
        var dup = new HashMap<>(b); dup.put("variables", List.of(Map.of("name", "a"), Map.of("name", "a")));
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/blocks", dup, Map.class).getStatusCode());
    }

    private Template blockTemplate(String hostValue) {
        Template t = template(chart("abc", 1, 10, 10, 200, 100), chart("abc", 2, 220, 10, 200, 100));
        for (var e : t.pages.get(0).elements) {
            e.chart.vars.put("host", hostValue); e.chart.vars.put("job", "node");
            e.group = new Template.Group(); e.group.id = "g1"; e.group.name = "Linux";
        }
        return t;
    }

    @Test @Order(18) void blockVariablesAreSentToGrafanaForEveryChart() throws Exception {
        configure(); grafana.requests.clear();
        var r = rest.postForEntity("/api/reports/generate", blockTemplate("web-01"), byte[].class);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        var reqs = grafana.requests.stream().map(q -> FakeGrafana.query(q.substring(q.indexOf('?') + 1))).toList();
        assertEquals(2, reqs.size());
        for (var q : reqs) { assertEquals("web-01", q.get("var-host")); assertEquals("node", q.get("var-job")); }
    }

    @Test @Order(19) void reportVariablesAndQueryOverridesResolveReferences() throws Exception {
        configure(); grafana.requests.clear();
        var t = blockTemplate("{{server}}");
        t.variables.put("server", "db-07");
        var r1 = rest.postForEntity("/api/reports/generate", t, byte[].class);
        assertTrue(grafana.requests.stream().allMatch(q -> FakeGrafana.query(q.substring(q.indexOf('?') + 1)).get("var-host").equals("db-07")));
        grafana.requests.clear();
        rest.postForEntity("/api/reports/generate?var-server=cli-override", t, byte[].class);
        assertTrue(grafana.requests.stream().allMatch(q -> FakeGrafana.query(q.substring(q.indexOf('?') + 1)).get("var-host").equals("cli-override")));
        // same variables are available in texts
        var t2 = template(text("<p>Server: {{server}}</p>", 10, 10, 200, 30)); t2.variables.put("server", "db-07");
        var r2 = rest.postForEntity("/api/reports/generate", t2, byte[].class);
        assertTrue(new XWPFDocument(new ByteArrayInputStream(r2.getBody())).getParagraphs().stream().anyMatch(p -> p.getText().equals("Server: db-07")));
    }

    @Test @Order(20) void undefinedReportVariableWarnsOrFailsInStrictMode() {
        configure();
        var t = blockTemplate("{{missing}}");
        var r = rest.postForEntity("/api/reports/generate", t, byte[].class);
        assertEquals(HttpStatus.OK, r.getStatusCode());
        assertTrue(URLDecoder.decode(r.getHeaders().getFirst("X-Report-Warnings"), StandardCharsets.UTF_8).contains("{{missing}}"));
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/reports/generate?strict=true", t, Map.class).getStatusCode());
    }

    @Test @Order(21) void groupAndVariablesSurviveTemplateRoundTrip() {
        var t = blockTemplate("h1"); t.variables.put("k", "v");
        var saved = rest.postForEntity("/api/templates", t, Template.class).getBody();
        var back = rest.getForObject("/api/templates/" + saved.id, Template.class);
        assertEquals("g1", back.pages.get(0).elements.get(0).group.id);
        assertEquals("h1", back.pages.get(0).elements.get(1).chart.vars.get("host"));
        assertEquals("v", back.variables.get("k"));
    }

    // ---------- parallelism & asynchronous jobs ----------

    @SuppressWarnings("unchecked")
    private Map<String, Object> awaitJob(String id, long timeoutMs) throws Exception {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            var j = (Map<String, Object>) rest.getForObject("/api/reports/jobs/" + id, Map.class);
            if (!"RUNNING".equals(j.get("state"))) return j;
            Thread.sleep(40);
        }
        throw new AssertionError("job still running after " + timeoutMs + " ms");
    }
    @SuppressWarnings("unchecked")
    private String startJob(Template t, String query) {
        var r = rest.postForEntity("/api/reports/jobs" + query, t, Map.class);
        assertEquals(HttpStatus.ACCEPTED, r.getStatusCode());
        return (String) r.getBody().get("id");
    }
    private Template slowTemplate(int charts) {
        Template.Element[] els = new Template.Element[charts];
        for (int i = 0; i < charts; i++) els[i] = chart("slow", i + 1, 10, 10 + i * 20, 100, 50);
        return template(els);
    }
    private void parallelism(int n) { rest.put("/api/settings", Map.of("parallelism", n)); }

    @Test @Order(22) void parallelismSettingIsValidatedAndPersisted() throws Exception {
        configure();
        assertEquals(4, map(rest.getForEntity("/api/settings", Map.class)).get("parallelism"), "default");
        var h = new HttpHeaders(); h.setContentType(MediaType.APPLICATION_JSON);
        for (String bad : new String[]{"0", "17", "-3"})
            assertEquals(HttpStatus.BAD_REQUEST, rest.exchange("/api/settings", HttpMethod.PUT, new HttpEntity<>("{\"parallelism\":" + bad + "}", h), Map.class).getStatusCode(), bad);
        parallelism(3);
        assertEquals(3, map(rest.getForEntity("/api/settings", Map.class)).get("parallelism"));
        assertTrue(Files.readString(dataDir.resolve("settings.json")).contains("\"parallelism\":3"));
        assertEquals(FakeGrafana.TOKEN.length() > 0, Files.readString(dataDir.resolve("settings.json")).contains(FakeGrafana.TOKEN), "token kept when only parallelism changes");
    }

    @Test @Order(23) void jobLifecycleStartPollDownloadRemove() throws Exception {
        configure(); parallelism(4);
        var t = template(chart("abc", 1, 10, 10, 200, 100), chart("abc", 2, 10, 120, 200, 100), chart("abc", 3, 10, 230, 200, 100)); t.name = "Job report";
        String id = startJob(t, "");
        var done = awaitJob(id, 10_000);
        assertEquals("DONE", done.get("state")); assertEquals(3, done.get("done")); assertEquals(3, done.get("total"));
        assertNotNull(done.get("finishedAt")); assertTrue((Integer) done.get("sizeBytes") > 1000);
        var file = rest.getForEntity("/api/reports/jobs/" + id + "/file", byte[].class);
        assertEquals(HttpStatus.OK, file.getStatusCode());
        assertEquals(3, new XWPFDocument(new ByteArrayInputStream(file.getBody())).getAllPictures().size());
        assertTrue(URLDecoder.decode(file.getHeaders().getContentDisposition().toString(), StandardCharsets.UTF_8).contains("Job report.docx"));
        assertTrue(rest.getForObject("/api/reports/jobs", List.class).stream().anyMatch(o -> ((Map<?, ?>) o).get("id").equals(id)));
        rest.delete("/api/reports/jobs/" + id);                                   // finished job: removed from the list
        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/reports/jobs/" + id, Map.class).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND, rest.exchange("/api/reports/jobs/" + id, HttpMethod.DELETE, null, Void.class).getStatusCode());
    }

    @Test @Order(24) void parallelismLimitsConcurrentRendersPerReport() throws Exception {
        configure();
        for (int n : new int[]{1, 2, 6}) {
            parallelism(n); grafana.maxInflight.set(0);
            long t0 = System.currentTimeMillis();
            var j = awaitJob(startJob(slowTemplate(6), ""), 30_000);
            long took = System.currentTimeMillis() - t0;
            assertEquals("DONE", j.get("state"));
            assertEquals(n, grafana.maxInflight.get(), "max concurrent renders with parallelism=" + n);
            // 6 slow (700 ms) charts: sequential ≈ 4.2 s, 2 at a time ≈ 2.1 s, all at once ≈ 0.7 s
            if (n == 1) assertTrue(took >= 4000, "took " + took);
            if (n == 6) assertTrue(took < 2500, "took " + took);
        }
    }

    @Test @Order(25) void runningJobCanBeCancelledAndStopsRenderingCharts() throws Exception {
        configure(); parallelism(1); grafana.requests.clear();
        String id = startJob(slowTemplate(8), "");                              // ≈ 5.6 s when run to the end
        Thread.sleep(900);
        assertEquals("RUNNING", map(rest.getForEntity("/api/reports/jobs/" + id, Map.class)).get("state"));
        long t0 = System.currentTimeMillis();
        rest.delete("/api/reports/jobs/" + id);
        var j = awaitJob(id, 3000);
        assertEquals("CANCELLED", j.get("state")); assertTrue(System.currentTimeMillis() - t0 < 1500, "cancel must be prompt");
        assertEquals(HttpStatus.CONFLICT, rest.getForEntity("/api/reports/jobs/" + id + "/file", byte[].class).getStatusCode());
        int sent = grafana.requests.size();
        Thread.sleep(1800);
        assertEquals(sent, grafana.requests.size(), "no further requests after cancellation");
        assertTrue(sent < 8, "only " + sent + " of 8 charts were requested");
        rest.delete("/api/reports/jobs/" + id);                                   // second delete removes the cancelled entry
        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/reports/jobs/" + id, Map.class).getStatusCode());
        parallelism(4);
    }

    @Test @Order(26) void failedJobsReportTheErrorAndWarningsArePreserved() throws Exception {
        configure(); parallelism(4);
        var t = template(chart("boom", 1, 10, 10, 200, 100), chart("abc", 1, 10, 120, 200, 100));
        var strict = awaitJob(startJob(t, "?strict=true"), 10_000);
        assertEquals("FAILED", strict.get("state")); assertTrue(strict.get("error").toString().contains("HTTP 500"), String.valueOf(strict.get("error")));
        assertEquals(HttpStatus.CONFLICT, rest.getForEntity("/api/reports/jobs/" + strict.get("id") + "/file", byte[].class).getStatusCode());
        var lenient = awaitJob(startJob(t, ""), 10_000);
        assertEquals("DONE", lenient.get("state"));
        assertTrue(lenient.get("warnings").toString().contains("P1"));
        var x = rest.getForEntity("/api/reports/jobs/" + lenient.get("id") + "/file", byte[].class);
        assertTrue(URLDecoder.decode(x.getHeaders().getFirst("X-Report-Warnings"), StandardCharsets.UTF_8).contains("P1"));
    }

    @Test @Order(27) void invalidJobRequestsAreRejectedAndJobVariablesApply() throws Exception {
        configure(); parallelism(4);
        Template bad = template(); bad.pages.clear();
        assertEquals(HttpStatus.BAD_REQUEST, rest.postForEntity("/api/reports/jobs", bad, Map.class).getStatusCode());
        var t = blockTemplate("{{server}}"); grafana.requests.clear();
        awaitJob(startJob(t, "?var-server=job-host"), 10_000);
        assertTrue(grafana.requests.stream().allMatch(q -> FakeGrafana.query(q.substring(q.indexOf('?') + 1)).get("var-host").equals("job-host")));
        assertEquals(HttpStatus.NOT_FOUND, rest.getForEntity("/api/reports/jobs/nope", Map.class).getStatusCode());
    }
}
