package com.example.reporter.docx;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Minimal inline-CSS helpers for the HTML produced by the rich-text editor. */
final class CssUtil {
    private CssUtil() {}

    private static final Pattern RGB = Pattern.compile("rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})(?:\\s*,\\s*([\\d.]+))?\\s*\\)");
    private static final Pattern HEX = Pattern.compile("#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})");
    private static final Pattern SIZE = Pattern.compile("([0-9.]+)\\s*(px|pt)?");

    static Map<String, String> parse(String style) {
        Map<String, String> m = new LinkedHashMap<>();
        if (style == null) return m;
        for (String decl : style.split(";")) {
            int i = decl.indexOf(':');
            if (i > 0) m.put(decl.substring(0, i).trim().toLowerCase(), decl.substring(i + 1).trim());
        }
        return m;
    }

    /** Returns RRGGBB (upper-case) or null when the value is not a usable colour / is transparent. */
    static String color(String v) {
        if (v == null) return null;
        v = v.trim();
        Matcher m = HEX.matcher(v);
        if (m.matches()) {
            String h = m.group(1);
            if (h.length() == 3) h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
            return h.toUpperCase();
        }
        m = RGB.matcher(v);
        if (m.matches()) {
            if (m.group(4) != null && Double.parseDouble(m.group(4)) == 0) return null;
            return String.format("%02X%02X%02X", clamp(m.group(1)), clamp(m.group(2)), clamp(m.group(3)));
        }
        return switch (v.toLowerCase()) {
            case "black" -> "000000"; case "white" -> "FFFFFF"; case "red" -> "FF0000"; case "blue" -> "0000FF";
            case "green" -> "008000"; case "yellow" -> "FFFF00"; case "gray", "grey" -> "808080"; case "orange" -> "FFA500";
            default -> null;
        };
    }

    /** Editor convention: 1 CSS px on the page canvas == 1 pt, so px and pt are both read as points. */
    static Double sizePt(String v) {
        if (v == null) return null;
        Matcher m = SIZE.matcher(v.trim());
        if (!m.matches()) return null;
        double d = Double.parseDouble(m.group(1));
        return d >= 1 && d <= 400 ? d : null;
    }

    static String firstFont(String v) {
        if (v == null) return null;
        String f = v.split(",")[0].trim().replaceAll("^['\"]|['\"]$", "");
        return f.isEmpty() ? null : f;
    }

    private static int clamp(String s) { return Math.min(255, Integer.parseInt(s)); }
}
