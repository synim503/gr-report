package com.example.reporter.docx;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;

/** PNG shown in the report in place of a chart that could not be rendered. */
public final class PlaceholderImage {
    private PlaceholderImage() {}

    public static byte[] png(int w, int h, String title, String message) {
        System.setProperty("java.awt.headless", "true");
        w = Math.max(40, Math.min(w, 2000)); h = Math.max(30, Math.min(h, 2000));
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setColor(new Color(0xFDF2F2)); g.fillRect(0, 0, w, h);
            g.setColor(new Color(0xD14343)); g.setStroke(new BasicStroke(2f, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER, 10f, new float[]{8, 6}, 0));
            g.drawRect(1, 1, w - 3, h - 3);
            int fs = Math.max(11, Math.min(w, h) / 18);
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, fs));
            g.drawString(fit(g, "Chart unavailable" + (title == null || title.isBlank() ? "" : ": " + title), w - 20), 10, 10 + fs);
            g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, Math.max(10, fs - 2)));
            g.setColor(new Color(0x555555));
            g.drawString(fit(g, message == null ? "" : message, w - 20), 10, 14 + fs * 2 + 4);
        } finally { g.dispose(); }
        try (ByteArrayOutputStream o = new ByteArrayOutputStream()) {
            ImageIO.write(img, "png", o);
            return o.toByteArray();
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }

    private static String fit(Graphics2D g, String s, int maxW) {
        FontMetrics m = g.getFontMetrics();
        while (s.length() > 3 && m.stringWidth(s) > maxW) s = s.substring(0, s.length() - 4) + "…";
        return s;
    }
}
