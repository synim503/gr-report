package com.example.reporter.docx;

import com.example.reporter.model.Template;
import com.example.reporter.model.Template.Element;

import java.util.*;

/**
 * Figure captions. An element with a caption reserves {@link #HEIGHT} pt of its box for the caption line; figures are numbered
 * automatically in reading order: page by page, rows top to bottom (elements whose tops are within {@link #ROW_TOLERANCE} pt form
 * one row), left to right inside a row. The editor implements the same algorithm (frontend/src/lib/captions.ts).
 */
public final class Captions {
    private Captions() {}

    public static final double HEIGHT = 22;
    public static final double ROW_TOLERANCE = 8;

    public static boolean has(Element e) {
        return e.caption != null && (e.type == Template.Type.chart || e.type == Template.Type.image);
    }

    public static Map<Element, Integer> number(Template t) {
        Map<Element, Integer> out = new IdentityHashMap<>();
        int n = 0;
        for (Template.Page p : t.pages) for (Element e : ordered(p.elements)) out.put(e, ++n);
        return out;
    }

    /** Captioned elements of one page in numbering order. */
    public static List<Element> ordered(List<Element> els) {
        List<Element> list = new ArrayList<>();
        for (Element e : els) if (has(e)) list.add(e);
        list.sort(Comparator.<Element>comparingDouble(e -> e.y).thenComparingDouble(e -> e.x));
        List<Element> out = new ArrayList<>();
        int i = 0;
        while (i < list.size()) {
            double anchor = list.get(i).y;
            List<Element> row = new ArrayList<>();
            while (i < list.size() && list.get(i).y - anchor <= ROW_TOLERANCE) row.add(list.get(i++));
            row.sort(Comparator.comparingDouble(e -> e.x));
            out.addAll(row);
        }
        return out;
    }

    /** The part of the element box that holds the picture (the caption line is cut off). */
    public static Element pictureBox(Element e) {
        if (!has(e)) return e;
        Element c = copy(e);
        c.h = Math.max(10, e.h - HEIGHT);
        if ("above".equals(e.caption.position)) c.y = e.y + e.h - c.h;
        return c;
    }

    /** The caption line box. */
    public static Element captionBox(Element e) {
        Element c = copy(e);
        c.type = Template.Type.text;
        c.h = Math.min(HEIGHT, e.h);
        c.y = "above".equals(e.caption.position) ? e.y : e.y + e.h - c.h;
        c.lineHeight = 1;
        return c;
    }

    private static Element copy(Element e) {
        Element c = new Element();
        c.id = e.id; c.type = e.type; c.x = e.x; c.y = e.y; c.w = e.w; c.h = e.h; c.z = e.z; c.lineHeight = e.lineHeight;
        return c;
    }

    /** Word SEQ identifier for the label (letters only; falls back to "Figure"). */
    public static String seqName(String label) {
        String s = label == null ? "" : label.replaceAll("[^\\p{L}]", "");
        return s.isEmpty() ? "Figure" : s;
    }
}
