package com.example.reporter.grafana;

import com.example.reporter.model.Settings;
import com.example.reporter.store.SettingsStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

/** Thin Grafana HTTP API client authenticated with a (service account) bearer token. */
@Component
public class GrafanaClient {
    public record Connection(String url, String token, int orgId) {}
    public record ConnectionResult(boolean ok, String version, String org, String message) {}
    public record DashboardSummary(String uid, String title, String folder, List<String> tags) {}
    public record PanelInfo(int id, String title, String type, int gridX, int gridY, int gridW, int gridH) {}
    public record Variable(String name, String label, String type, String defaultValue, List<String> options, boolean dynamic, boolean includeAll) {}
    public record Dashboard(String uid, String title, String slug, List<PanelInfo> panels, List<Variable> variables) {}

    private final SettingsStore settings;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();

    public GrafanaClient(SettingsStore settings, ObjectMapper mapper) {
        this.settings = settings;
        this.mapper = mapper;
    }

    public Connection saved() {
        Settings s = settings.get();
        if (s.grafanaUrl == null || s.grafanaUrl.isBlank()) throw new GrafanaException(0, "Grafana URL is not configured");
        return new Connection(s.grafanaUrl, s.token, s.orgId);
    }

    // ---- public API ----

    public ConnectionResult test(Connection c) {
        String version = null;
        try {
            JsonNode h = json(get(c, "/api/health", false));
            version = h.path("version").asText(null);
        } catch (GrafanaException e) {
            return new ConnectionResult(false, null, null, "Grafana is not reachable: " + e.getMessage());
        }
        try {
            JsonNode org = json(get(c, "/api/org", true));
            return new ConnectionResult(true, version, org.path("name").asText(null), "Connected");
        } catch (GrafanaException e) {
            String msg = e.status() == 401 || e.status() == 403
                    ? "Token rejected by Grafana (HTTP " + e.status() + ")" : e.getMessage();
            return new ConnectionResult(false, version, null, msg);
        }
    }

    public List<DashboardSummary> searchDashboards(Connection c, String query) {
        String path = "/api/search?type=dash-db&limit=200&query=" + enc(query == null ? "" : query);
        JsonNode arr = json(get(c, path, true));
        List<DashboardSummary> out = new ArrayList<>();
        for (JsonNode n : arr) {
            List<String> tags = new ArrayList<>();
            n.path("tags").forEach(t -> tags.add(t.asText()));
            out.add(new DashboardSummary(n.path("uid").asText(), n.path("title").asText(),
                    n.path("folderTitle").asText(null), tags));
        }
        return out;
    }

    public Dashboard dashboard(Connection c, String uid) {
        JsonNode root = json(get(c, "/api/dashboards/uid/" + enc(uid), true));
        JsonNode d = root.path("dashboard");
        List<PanelInfo> panels = new ArrayList<>();
        collectPanels(d.path("panels"), panels);
        String slug = "_";
        String url = root.path("meta").path("url").asText("");
        int i = url.lastIndexOf('/');
        if (i >= 0 && i < url.length() - 1) slug = url.substring(i + 1);
        List<Variable> vars = new ArrayList<>();
        for (JsonNode v : d.path("templating").path("list")) {
            String type = v.path("type").asText("");
            if (type.equals("datasource") || type.equals("interval") && v.path("name").asText("").startsWith("__")) continue;
            JsonNode cur = v.path("current").path("value");
            String def = cur.isArray() ? (cur.size() > 0 ? cur.get(0).asText("") : "") : cur.asText(v.path("query").asText(""));
            if (def.equals("$__all")) def = "All";
            String label = v.path("label").asText("");
            List<String> options = new ArrayList<>();
            for (JsonNode o : v.path("options")) {
                String val = o.path("value").asText(o.path("text").asText(""));
                if (val.equals("$__all")) val = "All";
                if (!val.isEmpty() && !options.contains(val) && options.size() < 200) options.add(val);
            }
            if (options.isEmpty() && type.equals("custom"))
                for (String o : v.path("query").asText("").split(",")) { o = o.trim(); if (!o.isEmpty() && options.size() < 200) options.add(o); }
            vars.add(new Variable(v.path("name").asText(), label.isEmpty() ? v.path("name").asText() : label, type, def, options,
                    type.equals("query"), v.path("includeAll").asBoolean(false)));
        }
        return new Dashboard(uid, d.path("title").asText(uid), slug, panels, vars);
    }

    /** Renders a single panel to PNG through Grafana's image renderer (/render/d-solo). */
    public byte[] renderPanel(Connection c, String uid, String slug, int panelId, int width, int height,
                              String from, String to, String theme, String tz, Map<String, String> vars) {
        StringBuilder q = new StringBuilder("/render/d-solo/").append(enc(uid)).append('/').append(enc(slug == null ? "_" : slug))
                .append("?orgId=").append(c.orgId())
                .append("&panelId=").append(panelId)
                .append("&width=").append(width).append("&height=").append(height)
                .append("&from=").append(enc(from)).append("&to=").append(enc(to))
                .append("&theme=").append(enc(theme == null || theme.isBlank() ? "light" : theme))
                .append("&tz=").append(enc(tz == null || tz.isBlank() ? "browser" : tz));
        if (vars != null) vars.forEach((k, v) -> q.append("&var-").append(enc(k)).append('=').append(enc(v)));
        byte[] body = get(c, q.toString(), true, Duration.ofSeconds(90));
        if (!isPng(body)) throw new GrafanaException(502,
                "Grafana did not return an image. Is the grafana-image-renderer plugin/service installed?");
        return body;
    }

    public static boolean isPng(byte[] b) {
        return b != null && b.length > 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G';
    }

    // ---- internals ----

    /**
     * Flattens dashboard panels into one grid. Children of a collapsed row keep the coordinates they have when the row is
     * expanded, while the panels below the row already sit where the row was; so every collapsed row pushes the panels
     * below it down by the height of its children (otherwise they would overlap).
     */
    private void collectPanels(JsonNode arr, List<PanelInfo> out) {
        List<JsonNode> top = new ArrayList<>();
        arr.forEach(top::add);
        top.sort(Comparator.<JsonNode>comparingInt(p -> p.path("gridPos").path("y").asInt(0)).thenComparingInt(p -> p.path("gridPos").path("x").asInt(0)));
        int shift = 0;
        for (JsonNode p : top) {
            int y = p.path("gridPos").path("y").asInt(0);
            if ("row".equals(p.path("type").asText(""))) {
                JsonNode kids = p.path("panels");
                if (kids.size() > 0) {
                    int base = y + 1, bottom = base;
                    for (JsonNode k : kids) {
                        addPanel(k, k.path("gridPos").path("y").asInt(0) + shift, out);
                        bottom = Math.max(bottom, k.path("gridPos").path("y").asInt(0) + k.path("gridPos").path("h").asInt(8));
                    }
                    shift += bottom - base;
                }
                continue;
            }
            addPanel(p, y + shift, out);
        }
    }

    private void addPanel(JsonNode p, int gridY, List<PanelInfo> out) {
        if (!p.has("id")) return;
        out.add(new PanelInfo(p.path("id").asInt(), p.path("title").asText(""), p.path("type").asText(""),
                p.path("gridPos").path("x").asInt(0), gridY, p.path("gridPos").path("w").asInt(12), p.path("gridPos").path("h").asInt(8)));
    }

    // ---------- dashboard variable options (query variables are resolved through the datasource) ----------

    private static final java.util.regex.Pattern VAR_REF = java.util.regex.Pattern.compile("\\$\\{(\\w+)(?::[^}]*)?}|\\$(\\w+)|\\[\\[(\\w+)(?::\\w+)?]]");
    private static final java.util.regex.Pattern LABEL_VALUES = java.util.regex.Pattern.compile("(?s)^\\s*label_values\\(\\s*(?:(.*),\\s*)?([A-Za-z_][A-Za-z0-9_]*)\\s*\\)\\s*$");

    /**
     * Values of a dashboard variable. custom / interval variables come from the dashboard JSON; Prometheus query variables
     * (label_values(...)) are asked from the datasource through Grafana, with other variables substituted by `current`
     * (chained variables such as nodename → label_values(node_uname_info{job="$job"}, nodename)).
     */
    public List<String> variableOptions(Connection c, String dashUid, String varName, Map<String, String> current) {
        JsonNode dash = json(get(c, "/api/dashboards/uid/" + enc(dashUid), true)).path("dashboard");
        JsonNode var = null;
        for (JsonNode v : dash.path("templating").path("list")) if (varName.equals(v.path("name").asText())) var = v;
        if (var == null) throw new GrafanaException(404, "Variable not found: " + varName);
        String type = var.path("type").asText("");
        List<String> out = new ArrayList<>();
        if (!type.equals("query")) {
            for (JsonNode o : var.path("options")) { String val = o.path("value").asText(""); if (!val.isEmpty()) out.add(val.equals("$__all") ? "All" : val); }
            if (out.isEmpty()) for (String o : var.path("query").asText("").split(",")) if (!o.trim().isEmpty()) out.add(o.trim());
            return out;
        }
        // datasource: object {type, uid}, plain name/uid, or a reference to a datasource variable
        JsonNode dsNode = var.path("datasource");
        String dsRef = dsNode.isObject() ? dsNode.path("uid").asText(dsNode.path("name").asText("")) : dsNode.asText("");
        String ref = substitute(dsRef, dash, current, false);
        JsonNode ds = findDatasource(c, ref);
        String dsType = ds.path("type").asText("");
        if (!dsType.contains("prometheus") && !dsType.contains("victoria") && !dsType.contains("mimir") && !dsType.contains("thanos"))
            throw new GrafanaException(422, "Values of '" + varName + "' cannot be loaded: datasource type '" + dsType + "' is not supported — enter the value manually");
        JsonNode qn = var.path("query");
        String query = qn.isObject() ? qn.path("query").asText(qn.path("expr").asText("")) : qn.asText("");
        if (query.isBlank()) query = var.path("definition").asText("");
        var m = LABEL_VALUES.matcher(query);
        if (!m.matches()) throw new GrafanaException(422, "Values of '" + varName + "' cannot be loaded: unsupported query. Only label_values(...) is supported — enter the value manually");
        String selector = m.group(1) == null ? null : substitute(m.group(1).trim(), dash, current, true)
                .replaceAll("([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*\"\\.\\*\"", "$1=~\".*\"");   // `label="All"` means "any value": needs the regex operator
        String label = m.group(2);
        long now = System.currentTimeMillis() / 1000;
        StringBuilder path = new StringBuilder("/api/datasources/proxy/uid/").append(enc(ds.path("uid").asText())).append("/api/v1/label/").append(enc(label))
                .append("/values?start=").append(now - 6 * 3600).append("&end=").append(now);
        if (selector != null && !selector.isBlank()) path.append("&match%5B%5D=").append(enc(selector));
        JsonNode data = json(get(c, path.toString(), true, Duration.ofSeconds(30))).path("data");
        for (JsonNode v : data) if (out.size() < 500) out.add(v.asText());
        java.util.Collections.sort(out);
        if (var.path("includeAll").asBoolean(false)) out.add(0, "All");
        return out;
    }

    /** Replaces $var / ${var} / [[var]] by the selected value (All → .* in selectors). */
    private String substitute(String text, JsonNode dash, Map<String, String> current, boolean regex) {
        var m = VAR_REF.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String name = m.group(1) != null ? m.group(1) : m.group(2) != null ? m.group(2) : m.group(3);
            String val = current.get(name);
            if (val == null) for (JsonNode v : dash.path("templating").path("list")) if (name.equals(v.path("name").asText())) {
                JsonNode cv = v.path("current").path("value");
                val = cv.isArray() ? (cv.size() > 0 ? cv.get(0).asText() : "") : cv.asText("");
            }
            if (val == null) val = name.startsWith("__") ? "5m" : "";
            if (val.equals("All") || val.equals("$__all") || (val.isEmpty() && regex)) val = regex ? ".*" : val;
            m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(val));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private JsonNode findDatasource(Connection c, String ref) {
        if (ref == null || ref.isBlank()) {
            JsonNode all = json(get(c, "/api/datasources", true));
            for (JsonNode d : all) if (d.path("isDefault").asBoolean(false)) return d;
            throw new GrafanaException(422, "The variable has no datasource");
        }
        try { return json(get(c, "/api/datasources/uid/" + enc(ref), true)); }
        catch (GrafanaException e) { if (e.status() != 404) throw e; }
        return json(get(c, "/api/datasources/name/" + enc(ref), true));
    }

    private JsonNode json(byte[] b) {
        try { return mapper.readTree(b); }
        catch (IOException e) { throw new GrafanaException(502, "Grafana returned invalid JSON", e); }
    }

    private byte[] get(Connection c, String path, boolean auth) { return get(c, path, auth, Duration.ofSeconds(30)); }

    private byte[] get(Connection c, String path, boolean auth, Duration timeout) {
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(c.url() + path)).timeout(timeout).GET()
                .header("Accept", "application/json, image/png");
        if (auth && c.token() != null && !c.token().isBlank()) rb.header("Authorization", "Bearer " + c.token());
        try {
            HttpResponse<byte[]> r = http.send(rb.build(), HttpResponse.BodyHandlers.ofByteArray());
            if (r.statusCode() / 100 != 2) {
                String msg = switch (r.statusCode()) {
                    case 401 -> "Grafana: unauthorized (check the token)";
                    case 403 -> "Grafana: forbidden (token lacks permissions)";
                    case 404 -> "Grafana: not found";
                    default -> "Grafana HTTP " + r.statusCode();
                };
                throw new GrafanaException(r.statusCode(), msg);
            }
            return r.body();
        } catch (IllegalArgumentException e) {
            throw new GrafanaException(0, "Invalid Grafana URL: " + c.url(), e);
        } catch (IOException e) {
            throw new GrafanaException(0, "Cannot reach Grafana: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new GrafanaException(0, "Interrupted", e);
        }
    }

    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20"); }
}
