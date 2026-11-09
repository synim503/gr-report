package com.example.reporter.docx;

import com.example.reporter.grafana.GrafanaClient;
import com.example.reporter.grafana.GrafanaException;
import com.example.reporter.model.Settings;
import com.example.reporter.model.Template;
import com.example.reporter.model.Template.Element;
import com.example.reporter.store.SettingsStore;
import org.apache.poi.xwpf.usermodel.Document;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;

@Service
public class ReportService {
    public record Result(byte[] docx, List<String> warnings) {}

    private final GrafanaClient grafana;
    private final SettingsStore settings;
    private final ExecutorService pool = Executors.newFixedThreadPool(4, r -> {
        Thread t = new Thread(r, "chart-render"); t.setDaemon(true); return t;
    });

    public ReportService(GrafanaClient grafana, SettingsStore settings) {
        this.grafana = grafana;
        this.settings = settings;
    }

    /** @param strict when true a failing chart aborts generation; otherwise a placeholder is inserted and a warning is returned. */
    public Result generate(Template t, boolean strict) throws IOException { return generate(t, strict, Map.of()); }

    /** @param overrides report variable values supplied at generation time; they win over template.variables. */
    public Result generate(Template t, boolean strict, Map<String, String> overrides) throws IOException {
        Map<String, String> reportVars = new LinkedHashMap<>(t.variables == null ? Map.of() : t.variables);
        reportVars.putAll(overrides);
        Settings s = settings.get();
        Map<Element, DocxBuilder.Image> images = new IdentityHashMap<>();
        List<String> warnings = Collections.synchronizedList(new ArrayList<>());
        Map<String, String> slugs = new ConcurrentHashMap<>();

        List<Element> all = new ArrayList<>();
        for (Template.Page p : t.pages) all.addAll(p.elements);

        Map<Element, Future<DocxBuilder.Image>> futures = new IdentityHashMap<>();
        for (Element e : all) {
            if (e.type == Template.Type.image) {
                images.put(e, decodeDataUrl(e, warnings));
            } else if (e.type == Template.Type.chart && e.chart != null) {
                futures.put(e, pool.submit(() -> renderChart(t, e, s, slugs, strict, warnings, reportVars)));
            }
        }
        for (var en : futures.entrySet()) {
            try { images.put(en.getKey(), en.getValue().get()); }
            catch (ExecutionException ex) {
                if (ex.getCause() instanceof RuntimeException re) throw re;
                throw new IOException(ex.getCause());
            } catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw new IOException(ex); }
        }
        images.values().removeIf(Objects::isNull);

        Map<String, String> vars = new HashMap<>(reportVars);
        LocalDateTime now = LocalDateTime.now();
        vars.put("date", now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")));
        vars.put("datetime", now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")));
        vars.put("from", t.timeRange.from);
        vars.put("to", t.timeRange.to);
        vars.put("name", t.name);
        return new Result(new DocxBuilder(t, images, vars).build(), warnings);
    }

    private DocxBuilder.Image renderChart(Template t, Element e, Settings s, Map<String, String> slugs, boolean strict, List<String> warnings, Map<String, String> reportVars) {
        Template.Chart c = e.chart;
        double scale = Math.max(1, Math.min(s.imageScale, 4));
        int w = (int) Math.max(50, Math.min(4000, Math.round(e.w * 96 / 72 * scale)));
        int h = (int) Math.max(50, Math.min(4000, Math.round(e.h * 96 / 72 * scale)));
        String from = c.from != null && !c.from.isBlank() ? c.from : t.timeRange.from;
        String to = c.to != null && !c.to.isBlank() ? c.to : t.timeRange.to;
        try {
            GrafanaClient.Connection conn = grafana.saved();
            String slug = slugs.computeIfAbsent(c.dashboardUid, uid -> grafana.dashboard(conn, uid).slug());
            Map<String, String> vars = resolveVars(c.vars, reportVars, strict, warnings, c);
            byte[] png = grafana.renderPanel(conn, c.dashboardUid, slug, c.panelId, w, h, from, to, c.theme, null, vars);
            return new DocxBuilder.Image(png, Document.PICTURE_TYPE_PNG);
        } catch (GrafanaException ex) {
            if (strict) throw ex;
            warnings.add("Chart '" + (c.title == null ? c.dashboardUid + "/" + c.panelId : c.title) + "': " + ex.getMessage());
            return new DocxBuilder.Image(PlaceholderImage.png(w, h, c.title, ex.getMessage()), Document.PICTURE_TYPE_PNG);
        }
    }

    private static final java.util.regex.Pattern REF = java.util.regex.Pattern.compile("\\{\\{\\s*([A-Za-z0-9_\\-.]+)\\s*}}");

    /** Replaces {{name}} references in chart variable values by report variables. */
    static Map<String, String> resolveVars(Map<String, String> chartVars, Map<String, String> reportVars, boolean strict,
                                           List<String> warnings, Template.Chart c) {
        Map<String, String> out = new LinkedHashMap<>();
        if (chartVars == null) return out;
        for (var en : chartVars.entrySet()) {
            var m = REF.matcher(en.getValue() == null ? "" : en.getValue());
            StringBuilder sb = new StringBuilder();
            while (m.find()) {
                String val = reportVars.get(m.group(1));
                if (val == null) {
                    String msg = "Variable {{" + m.group(1) + "}} used by chart '" + (c.title == null ? c.dashboardUid : c.title) + "' is not defined";
                    if (strict) throw new IllegalArgumentException(msg);
                    warnings.add(msg);
                    val = m.group();
                }
                m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(val));
            }
            m.appendTail(sb);
            out.put(en.getKey(), sb.toString());
        }
        return out;
    }

    private DocxBuilder.Image decodeDataUrl(Element e, List<String> warnings) {
        String d = e.dataUrl;
        try {
            if (d == null || !d.startsWith("data:image/")) throw new IllegalArgumentException("missing data URL");
            int comma = d.indexOf(',');
            String meta = d.substring(5, comma).toLowerCase();
            byte[] data = Base64.getDecoder().decode(d.substring(comma + 1));
            int type = meta.startsWith("image/png") ? Document.PICTURE_TYPE_PNG
                    : meta.startsWith("image/jpeg") || meta.startsWith("image/jpg") ? Document.PICTURE_TYPE_JPEG
                    : meta.startsWith("image/gif") ? Document.PICTURE_TYPE_GIF : -1;
            if (type < 0) throw new IllegalArgumentException("unsupported image type " + meta);
            return new DocxBuilder.Image(data, type);
        } catch (RuntimeException ex) {
            warnings.add("Image element skipped: " + ex.getMessage());
            return null;
        }
    }
}
