package com.example.reporter.web;

import com.example.reporter.docx.JobService;
import com.example.reporter.docx.ReportService;
import com.example.reporter.grafana.GrafanaClient;
import com.example.reporter.grafana.BlockFactory;
import com.example.reporter.model.Block;
import com.example.reporter.model.Settings;
import com.example.reporter.store.BlockStore;
import com.example.reporter.model.Template;
import com.example.reporter.store.SettingsStore;
import com.example.reporter.store.TemplateStore;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController
@RequestMapping("/api")
public class Controllers {
    private final SettingsStore settings;
    private final GrafanaClient grafana;
    private final TemplateStore templates;
    private final ReportService reports;
    private final BlockStore blocks;
    private final JobService jobs;

    public Controllers(SettingsStore settings, GrafanaClient grafana, TemplateStore templates, ReportService reports, BlockStore blocks, JobService jobs) {
        this.settings = settings; this.grafana = grafana; this.templates = templates; this.reports = reports; this.blocks = blocks; this.jobs = jobs;
    }

    // ---- settings ----
    public record SettingsView(String grafanaUrl, boolean tokenSet, String tokenHint, int orgId, double imageScale, int parallelism) {}
    public record SettingsUpdate(String grafanaUrl, String token, Integer orgId, Double imageScale, Integer parallelism) {}

    private SettingsView view(Settings s) {
        String t = s.token == null ? "" : s.token;
        return new SettingsView(s.grafanaUrl, !t.isBlank(), t.length() > 4 ? "••••" + t.substring(t.length() - 4) : (t.isBlank() ? "" : "••••"),
                s.orgId, s.imageScale, s.parallelism);
    }

    @GetMapping("/settings") public SettingsView getSettings() { return view(settings.get()); }

    @PutMapping("/settings")
    public SettingsView putSettings(@RequestBody SettingsUpdate u) {
        if (u.grafanaUrl() != null && !u.grafanaUrl().isBlank()) {
            String url = SettingsStore.normalize(u.grafanaUrl());
            if (!url.matches("^https?://[^\\s/]+(/\\S*)?$")) throw new IllegalArgumentException("Grafana URL must start with http:// or https://");
        }
        if (u.imageScale() != null && (u.imageScale() < 1 || u.imageScale() > 4)) throw new IllegalArgumentException("imageScale must be 1..4");
        if (u.parallelism() != null && (u.parallelism() < 1 || u.parallelism() > 16)) throw new IllegalArgumentException("parallelism must be 1..16");
        return view(settings.update(u.grafanaUrl(), u.token(), u.orgId(), u.imageScale(), u.parallelism()));
    }

    /** Tests either the supplied (unsaved) url/token or the saved ones. */
    @PostMapping("/grafana/test")
    public GrafanaClient.ConnectionResult test(@RequestBody(required = false) SettingsUpdate u) {
        Settings s = settings.get();
        String url = u != null && u.grafanaUrl() != null && !u.grafanaUrl().isBlank() ? SettingsStore.normalize(u.grafanaUrl()) : s.grafanaUrl;
        String token = u != null && u.token() != null && !u.token().isBlank() ? u.token() : s.token;
        if (url == null || url.isBlank()) return new GrafanaClient.ConnectionResult(false, null, null, "Grafana URL is not configured");
        return grafana.test(new GrafanaClient.Connection(url, token, s.orgId));
    }

    // ---- grafana browsing ----
    @GetMapping("/grafana/dashboards")
    public List<GrafanaClient.DashboardSummary> dashboards(@RequestParam(defaultValue = "") String query) {
        return grafana.searchDashboards(grafana.saved(), query);
    }

    @GetMapping("/grafana/dashboards/{uid}")
    public GrafanaClient.Dashboard dashboard(@PathVariable String uid) {
        requireUid(uid);
        return grafana.dashboard(grafana.saved(), uid);
    }

    /** PNG preview of a panel for the editor canvas. */
    @GetMapping(value = "/grafana/panel-image", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> panelImage(@RequestParam String uid, @RequestParam int panelId,
                                             @RequestParam(defaultValue = "800") int width, @RequestParam(defaultValue = "400") int height,
                                             @RequestParam(defaultValue = "now-6h") String from, @RequestParam(defaultValue = "now") String to,
                                             @RequestParam(defaultValue = "light") String theme,
                                             @RequestParam Map<String, String> all) {
        requireUid(uid);
        if (!from.matches("^[A-Za-z0-9_\\-+/:.]{1,40}$") || !to.matches("^[A-Za-z0-9_\\-+/:.]{1,40}$")) throw new IllegalArgumentException("invalid time range");
        if (!theme.matches("light|dark")) throw new IllegalArgumentException("invalid theme");
        width = Math.max(50, Math.min(width, 3000)); height = Math.max(50, Math.min(height, 3000));
        Map<String, String> vars = new HashMap<>();
        all.forEach((k, v) -> { if (k.startsWith("var-")) vars.put(k.substring(4), v); });
        GrafanaClient.Connection c = grafana.saved();
        String slug = grafana.dashboard(c, uid).slug();
        byte[] png = grafana.renderPanel(c, uid, slug, panelId, width, height, from, to, theme, null, vars);
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(java.time.Duration.ofSeconds(30)).cachePrivate()).body(png);
    }

    /** Values of one dashboard variable; other variables' current values (var-NAME=…) are used for chained queries. */
    @GetMapping("/grafana/dashboards/{uid}/variables/{name}/options")
    public Map<String, Object> variableOptions(@PathVariable String uid, @PathVariable String name, @RequestParam Map<String, String> all) {
        requireUid(uid);
        if (!name.matches("^[A-Za-z0-9_\\-.]{1,64}$")) throw new IllegalArgumentException("invalid variable name");
        Map<String, String> current = new HashMap<>();
        all.forEach((k, v) -> { if (k.startsWith("var-")) current.put(k.substring(4), v); });
        return Map.of("options", grafana.variableOptions(grafana.saved(), uid, name, current));
    }

    /** Block preset generated from the dashboard grid: all panels, same relative layout, variables with their defaults. */
    @GetMapping("/grafana/dashboards/{uid}/block")
    public Block dashboardBlock(@PathVariable String uid, @RequestParam(defaultValue = "515") double width) {
        requireUid(uid);
        if (width < 50 || width > 3000) throw new IllegalArgumentException("width must be 50..3000");
        return BlockFactory.fromDashboard(grafana.dashboard(grafana.saved(), uid), width);
    }

    private static void requireUid(String uid) {
        if (!uid.matches("^[A-Za-z0-9_\\-]{1,64}$")) throw new IllegalArgumentException("invalid dashboard uid");
    }

    // ---- templates ----
    @GetMapping("/templates") public List<TemplateStore.Summary> list() { return templates.list(); }

    @GetMapping("/templates/{id}")
    public ResponseEntity<Template> get(@PathVariable String id) {
        return templates.get(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/templates")
    public Template create(@Valid @RequestBody Template t) { return templates.save(null, t); }

    @PutMapping("/templates/{id}")
    public ResponseEntity<Template> update(@PathVariable String id, @Valid @RequestBody Template t) {
        if (templates.get(id).isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(templates.save(id, t));
    }

    @DeleteMapping("/templates/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        return templates.delete(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    // ---- block presets ----
    @GetMapping("/blocks") public List<Block> listBlocks() { return blocks.list(); }

    @PostMapping("/blocks") public Block createBlock(@Valid @RequestBody Block b) { return blocks.save(null, b); }

    @PutMapping("/blocks/{id}")
    public ResponseEntity<Block> updateBlock(@PathVariable String id, @Valid @RequestBody Block b) {
        if (blocks.get(id).isEmpty()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(blocks.save(id, b));
    }

    @DeleteMapping("/blocks/{id}")
    public ResponseEntity<Void> deleteBlock(@PathVariable String id) {
        return blocks.delete(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    // ---- generation ----
    public static final MediaType DOCX = MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    @PostMapping("/reports/generate")
    public ResponseEntity<byte[]> generate(@Valid @RequestBody Template t, @RequestParam(defaultValue = "false") boolean strict,
                                           @RequestParam Map<String, String> all) throws IOException {
        return respond(t, strict, overrides(all));
    }

    @PostMapping("/templates/{id}/generate")
    public ResponseEntity<byte[]> generateSaved(@PathVariable String id, @RequestParam(defaultValue = "false") boolean strict,
                                                @RequestParam Map<String, String> all) throws IOException {
        Template t = templates.get(id).orElse(null);
        if (t == null) return ResponseEntity.notFound().build();
        return respond(t, strict, overrides(all));
    }

    // ---- asynchronous jobs ----
    @PostMapping("/reports/jobs")
    public ResponseEntity<JobService.JobView> startJob(@Valid @RequestBody Template t, @RequestParam(defaultValue = "false") boolean strict,
                                                       @RequestParam Map<String, String> all) {
        return ResponseEntity.accepted().body(jobs.submit(t, strict, overrides(all)));
    }

    @GetMapping("/reports/jobs") public List<JobService.JobView> listJobs() { return jobs.list(); }

    @GetMapping("/reports/jobs/{id}")
    public ResponseEntity<JobService.JobView> job(@PathVariable String id) {
        return jobs.get(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/reports/jobs/{id}/file")
    public ResponseEntity<byte[]> jobFile(@PathVariable String id) {
        var view = jobs.get(id);
        if (view.isEmpty()) return ResponseEntity.notFound().build();
        var file = jobs.file(id);
        if (file.isEmpty()) return ResponseEntity.status(HttpStatus.CONFLICT).build();
        return docx(view.get().name(), file.get(), view.get().warnings());
    }

    /** Cancels a running job, or removes a finished one from the list. */
    @DeleteMapping("/reports/jobs/{id}")
    public ResponseEntity<Void> cancelJob(@PathVariable String id) {
        return jobs.cancelOrRemove(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /** Query parameters var-NAME=value override report variables at generation time. */
    private static Map<String, String> overrides(Map<String, String> all) {
        Map<String, String> o = new LinkedHashMap<>();
        all.forEach((k, v) -> { if (k.startsWith("var-") && k.length() > 4) o.put(k.substring(4), v); });
        return o;
    }

    private ResponseEntity<byte[]> respond(Template t, boolean strict, Map<String, String> overrides) throws IOException {
        ReportService.Result r = reports.generate(t, strict, overrides);
        return docx(t.name, r.docx(), r.warnings());
    }

    private ResponseEntity<byte[]> docx(String name, byte[] bytes, List<String> warnings) {
        String fname = name.replaceAll("[^\\p{L}\\p{N}._ -]", "_").trim();
        if (fname.isEmpty()) fname = "report";
        HttpHeaders h = new HttpHeaders();
        h.setContentType(DOCX);
        h.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"report.docx\"; filename*=UTF-8''" +
                URLEncoder.encode(fname + ".docx", StandardCharsets.UTF_8).replace("+", "%20"));
        h.set("X-Report-Warnings", URLEncoder.encode(String.join("\n", warnings), StandardCharsets.UTF_8));
        h.set(HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS, "X-Report-Warnings, Content-Disposition");
        return new ResponseEntity<>(bytes, h, HttpStatus.OK);
    }
}
