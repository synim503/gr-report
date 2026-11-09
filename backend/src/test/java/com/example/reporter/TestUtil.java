package com.example.reporter;

import com.example.reporter.model.Template;
import com.example.reporter.model.Template.Element;

public class TestUtil {
    public static Template template(Element... els) {
        Template t = new Template();
        t.name = "Test";
        Template.Page p = new Template.Page();
        p.elements.addAll(java.util.List.of(els));
        t.pages.add(p);
        return t;
    }
    public static Element text(String html, double x, double y, double w, double h) {
        Element e = new Element(); e.type = Template.Type.text; e.html = html; e.x = x; e.y = y; e.w = w; e.h = h; return e;
    }
    public static Element chart(String uid, int panel, double x, double y, double w, double h) {
        Element e = new Element(); e.type = Template.Type.chart; e.x = x; e.y = y; e.w = w; e.h = h;
        e.chart = new Template.Chart(); e.chart.dashboardUid = uid; e.chart.panelId = panel; e.chart.title = "P" + panel;
        return e;
    }
}
