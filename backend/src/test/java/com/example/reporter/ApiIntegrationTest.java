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
}
