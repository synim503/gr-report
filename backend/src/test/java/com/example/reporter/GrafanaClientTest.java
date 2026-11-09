package com.example.reporter;

import com.example.reporter.grafana.GrafanaClient;
import com.example.reporter.grafana.GrafanaClient.Connection;
import com.example.reporter.grafana.GrafanaClient.PanelInfo;
import com.example.reporter.grafana.GrafanaClient.Variable;
import com.example.reporter.grafana.GrafanaException;
import com.example.reporter.store.SettingsStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class GrafanaClientTest {
    static FakeGrafana grafana;
    GrafanaClient client;
    Connection good;

    @BeforeAll static void start() throws Exception { grafana = new FakeGrafana(); }
    @AfterAll static void stop() { grafana.close(); }

    @BeforeEach void init(@TempDir Path dir) throws Exception {
        client = new GrafanaClient(new SettingsStore(dir.toString(), new ObjectMapper(), "", ""), new ObjectMapper());
        good = new Connection(grafana.url(), FakeGrafana.TOKEN, 1);
        grafana.requests.clear(); grafana.authHeaders.clear();
    }

    @Test void connectionOkReportsVersionAndOrg() {
        var r = client.test(good);
        assertTrue(r.ok()); assertEquals("10.4.0", r.version()); assertEquals("Main Org.", r.org());
        assertTrue(grafana.authHeaders.contains("Bearer " + FakeGrafana.TOKEN), "token must be sent as Bearer");
    }

    @Test void connectionWithBadTokenIsRejectedWithClearMessage() {
        var r = client.test(new Connection(grafana.url(), "wrong", 1));
        assertFalse(r.ok()); assertTrue(r.message().contains("Token rejected")); assertEquals("10.4.0", r.version());
    }

    @Test void connectionToDeadHostFailsGracefully() {
        var r = client.test(new Connection("http://127.0.0.1:1", "x", 1));
        assertFalse(r.ok()); assertTrue(r.message().contains("not reachable"));
    }

    @Test void searchAndFilter() {
        assertEquals(2, client.searchDashboards(good, "").size());
        var f = client.searchDashboards(good, "cpu");
        assertEquals(1, f.size()); assertEquals("abc", f.get(0).uid()); assertEquals("Infra", f.get(0).folder()); assertEquals("linux", f.get(0).tags().get(0));
    }

    @Test void dashboardPanelsIncludeCollapsedRowChildrenButNotRows() {
        var d = client.dashboard(good, "abc");
        assertEquals("cpu-overview", d.slug());
        assertEquals(3, d.panels().size());
        assertEquals("Disk", d.panels().get(2).title());
        assertEquals(12, d.panels().get(0).gridW());
    }

    @Test void dashboardVariablesAndGridPositions() {
        var d = client.dashboard(good, "abc");
        assertEquals(2, d.variables().size(), "datasource variable is skipped");
        assertEquals("host", d.variables().get(0).name()); assertEquals("Host", d.variables().get(0).label());
        assertEquals("srv-default", d.variables().get(0).defaultValue());
        assertEquals("All", d.variables().get(1).defaultValue(), "$__all is shown as All");
        assertEquals(java.util.List.of("srv-default", "web-01", "db-02"), d.variables().get(0).options());
        assertEquals(java.util.List.of("All", "node", "app"), d.variables().get(1).options(), "$__all is shown as All");
        assertEquals(12, d.panels().get(1).gridX()); assertEquals(8, d.panels().get(2).gridY());
    }

    @Test void collapsedRowsAreExpandedAndPanelsBelowAreShiftedDown() {
        var ps = client.dashboard(good, "nodeexp").panels();
        assertEquals(6, ps.size(), "rows themselves are not panels");
        java.util.function.Function<String, PanelInfo> by = t -> ps.stream().filter(p -> p.title().equals(t)).findFirst().orElseThrow();
        assertEquals(0, by.apply("A").gridY()); assertEquals(5, by.apply("C").gridY()); assertEquals(5, by.apply("D").gridY());
        assertEquals(13, by.apply("E").gridY(), "E sat at y=5 while the CPU row was collapsed; expanded it moves below C/D (5+8)");
        assertEquals(22, by.apply("F").gridY(), "…and everything after it moves by the same 8 rows");
        for (var a : ps) for (var b : ps) if (a != b) assertFalse(a.gridX() < b.gridX() + b.gridW() && b.gridX() < a.gridX() + a.gridW()
                && a.gridY() < b.gridY() + b.gridH() && b.gridY() < a.gridY() + a.gridH(), a.title() + " overlaps " + b.title());
    }

    @Test void queryVariablesAreResolvedThroughTheDatasourceWithChainedValues() {
        var d = client.dashboard(good, "nodeexp");
        assertEquals(java.util.List.of("job", "nodename", "logs", "env"), d.variables().stream().map(Variable::name).toList(), "datasource variable hidden");
        assertTrue(d.variables().get(0).dynamic()); assertFalse(d.variables().get(3).dynamic());
        assertEquals(java.util.List.of("app", "node"), client.variableOptions(good, "nodeexp", "job", Map.of()), "values sorted");
        grafana.proxyRequests.clear();
        assertEquals(java.util.List.of("All", "srv1", "srv2"), client.variableOptions(good, "nodeexp", "nodename", Map.of("job", "node")));
        assertTrue(grafana.proxyRequests.get(0).contains("match%5B%5D=node_uname_info%7Bjob%3D%22node%22%7D"), grafana.proxyRequests.get(0));
        assertTrue(grafana.proxyRequests.get(0).contains("/label/nodename/values"));
        assertEquals(java.util.List.of("All", "app1"), client.variableOptions(good, "nodeexp", "nodename", Map.of("job", "app")), "depends on $job");
        assertEquals(java.util.List.of("All", "srv1", "srv2"), client.variableOptions(good, "nodeexp", "nodename", Map.of()), "falls back to the dashboard's current job");
        assertEquals(java.util.List.of("All", "app1", "srv1", "srv2"), client.variableOptions(good, "nodeexp", "nodename", Map.of("job", "All")), "All becomes a regex");
        assertEquals(java.util.List.of("prod", "stage"), client.variableOptions(good, "nodeexp", "env", Map.of()));
    }

    @Test void unsupportedOrUnknownVariablesGiveClearErrors() {
        var e = assertThrows(GrafanaException.class, () -> client.variableOptions(good, "nodeexp", "logs", Map.of()));
        assertEquals(422, e.status()); assertTrue(e.getMessage().contains("loki"));
        assertEquals(404, assertThrows(GrafanaException.class, () -> client.variableOptions(good, "nodeexp", "nope", Map.of())).status());
        assertEquals(401, assertThrows(GrafanaException.class, () -> client.variableOptions(new Connection(grafana.url(), "bad", 1), "nodeexp", "job", Map.of())).status());
    }

    @Test void missingDashboardIs404() {
        var e = assertThrows(GrafanaException.class, () -> client.dashboard(good, "missing"));
        assertEquals(404, e.status());
    }

    @Test void wrongTokenOnApiThrows401() {
        var e = assertThrows(GrafanaException.class, () -> client.searchDashboards(new Connection(grafana.url(), "bad", 1), ""));
        assertEquals(401, e.status()); assertTrue(e.getMessage().contains("token"));
    }

    @Test void renderPassesAllParametersAndReturnsPngOfRequestedSize() throws Exception {
        byte[] png = client.renderPanel(good, "abc", "cpu-overview", 7, 640, 320, "now-24h", "now-1h", "dark", "UTC", Map.of("host", "a b&c"));
        var img = ImageIO.read(new ByteArrayInputStream(png));
        assertEquals(640, img.getWidth()); assertEquals(320, img.getHeight());
        String req = grafana.requests.get(0);
        assertTrue(req.startsWith("/render/d-solo/abc/cpu-overview?"), req);
        var q = FakeGrafana.query(req.substring(req.indexOf('?') + 1));
        assertEquals("7", q.get("panelId")); assertEquals("now-24h", q.get("from")); assertEquals("now-1h", q.get("to"));
        assertEquals("dark", q.get("theme")); assertEquals("UTC", q.get("tz")); assertEquals("1", q.get("orgId"));
        assertEquals("a b&c", q.get("var-host"), "template variables are URL-encoded");
        assertEquals("Bearer " + FakeGrafana.TOKEN, grafana.authHeaders.get(0));
    }

    @Test void nonImageRenderResponseExplainsRendererProblem() {
        var e = assertThrows(GrafanaException.class, () -> client.renderPanel(good, "norender", "s", 1, 100, 100, "now-1h", "now", "light", null, null));
        assertTrue(e.getMessage().contains("image-renderer"));
    }

    @Test void renderServerErrorPropagates() {
        var e = assertThrows(GrafanaException.class, () -> client.renderPanel(good, "boom", "s", 1, 100, 100, "now-1h", "now", "light", null, null));
        assertEquals(500, e.status());
    }

    @Test void unconfiguredUrlIsReported() {
        assertThrows(GrafanaException.class, () -> client.saved());
    }
}
