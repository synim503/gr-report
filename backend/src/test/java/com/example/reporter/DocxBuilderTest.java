package com.example.reporter;

import com.example.reporter.docx.DocxBuilder;
import com.example.reporter.model.Template;
import com.example.reporter.model.Template.Element;
import org.apache.poi.xwpf.usermodel.*;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.util.*;

import static com.example.reporter.TestUtil.*;
import static org.junit.jupiter.api.Assertions.*;

class DocxBuilderTest {
    static final Map<String, String> VARS = Map.of("date", "2026-01-02", "from", "now-6h", "to", "now", "name", "Test", "datetime", "x");

    XWPFDocument build(Template t, Map<Element, DocxBuilder.Image> imgs) throws Exception {
        byte[] b = new DocxBuilder(t, imgs, VARS).build();
        return new XWPFDocument(new ByteArrayInputStream(b));
    }
    XWPFDocument build(Template t) throws Exception { return build(t, new IdentityHashMap<>()); }
    static String hex(Object o) { if (o instanceof byte[] b) { StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02X", x)); return sb.toString(); } return o.toString(); }
    static int n(Object o) { return Integer.parseInt(o.toString()); }
    static List<XWPFParagraph> framed(XWPFDocument d) { return d.getParagraphs().stream().filter(p -> p.getCTP().getPPr() != null && p.getCTP().getPPr().isSetFramePr()).toList(); }
    static XWPFRun run(XWPFDocument d, String text) {
        return d.getParagraphs().stream().flatMap(p -> p.getRuns().stream()).filter(r -> text.equals(r.text())).findFirst().orElseThrow(() -> new AssertionError("no run " + text));
    }
    static XWPFDocument one(String html) throws Exception { return new DocxBuilderTest().build(template(text(html, 10, 10, 200, 100))); }

    @Test void textFrameIsAbsolutelyPositionedOnPage() throws Exception {
        var d = build(template(text("<p>Hello</p>", 100, 200, 300, 80)));
        var fr = framed(d).get(0).getCTP().getPPr().getFramePr();
        assertEquals(2000, n(fr.getX()));   // 100pt = 2000 twips
        assertEquals(4000, n(fr.getY()));
        assertEquals(6000, n(fr.getW()));
        assertEquals(1600, n(fr.getH()));
        assertEquals("page", fr.getHAnchor().toString()); assertEquals("page", fr.getVAnchor().toString());
    }

    @Test void basicInlineFormatting() throws Exception {
        var d = one("<p><strong>B</strong><em>I</em><u>U</u><s>S</s><sub>sb</sub><sup>sp</sup></p>");
        assertTrue(run(d, "B").isBold()); assertTrue(run(d, "I").isItalic());
        assertEquals(UnderlinePatterns.SINGLE, run(d, "U").getUnderline()); assertTrue(run(d, "S").isStrikeThrough());
        assertEquals("subscript", run(d, "sb").getVerticalAlignment().toString().toLowerCase());
        assertEquals("superscript", run(d, "sp").getVerticalAlignment().toString().toLowerCase());
    }

    @Test void colorSizeFontHighlight() throws Exception {
        var d = one("<p><span style=\"color: #ff0000\">R</span><span style=\"color: rgb(0, 128, 255)\">C</span>" +
                "<span style=\"font-size: 18px\">Big</span><span style=\"font-size: 9.5pt\">Half</span>" +
                "<span style=\"font-family: 'Times New Roman'\">T</span><mark style=\"background-color: #00ff00\">M</mark><mark>Y</mark></p>");
        assertEquals("FF0000", run(d, "R").getColor()); assertEquals("0080FF", run(d, "C").getColor());
        assertEquals(18, run(d, "Big").getFontSizeAsDouble()); assertEquals(9.5, run(d, "Half").getFontSizeAsDouble());
        assertEquals("Times New Roman", run(d, "T").getFontFamily());
        assertEquals("00FF00", hex(run(d, "M").getCTR().getRPr().getShdArray(0).getFill()));
        assertEquals("FFFF00", hex(run(d, "Y").getCTR().getRPr().getShdArray(0).getFill()));
    }

    @Test void nestedMarksCombine() throws Exception {
        var d = one("<p><strong><em><span style=\"color:#123456\">X</span></em></strong></p>");
        var r = run(d, "X"); assertTrue(r.isBold() && r.isItalic()); assertEquals("123456", r.getColor());
    }

    @Test void alignmentForAllFour() throws Exception {
        var d = one("<p style=\"text-align: center\">c</p><p style=\"text-align: right\">r</p><p style=\"text-align: justify\">j</p><p>l</p>");
        var ps = framed(d);
        assertEquals(ParagraphAlignment.CENTER, ps.get(0).getAlignment()); assertEquals(ParagraphAlignment.RIGHT, ps.get(1).getAlignment());
        assertEquals(ParagraphAlignment.BOTH, ps.get(2).getAlignment()); assertEquals(ParagraphAlignment.LEFT, ps.get(3).getAlignment());
    }

    @Test void headingsGetSizeBoldAndOutlineLevel() throws Exception {
        var d = one("<h1>One</h1><h2>Two</h2><h3>Three</h3>");
        assertEquals(24, run(d, "One").getFontSizeAsDouble()); assertTrue(run(d, "One").isBold());
        assertEquals(18, run(d, "Two").getFontSizeAsDouble()); assertEquals(14, run(d, "Three").getFontSizeAsDouble());
        assertEquals(0, framed(d).get(0).getCTP().getPPr().getOutlineLvl().getVal().intValue());
        assertEquals(1, framed(d).get(1).getCTP().getPPr().getOutlineLvl().getVal().intValue());
    }

    @Test void headingFontSizeCanBeOverriddenBySpan() throws Exception {
        var d = one("<h1><span style=\"font-size: 30px\">Huge</span></h1>");
        assertEquals(30, run(d, "Huge").getFontSizeAsDouble()); assertTrue(run(d, "Huge").isBold());
    }

    @Test void bulletListUsesRealNumbering() throws Exception {
        var d = one("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
        var ps = framed(d);
        assertEquals(2, ps.size());
        assertNotNull(ps.get(0).getNumID()); assertEquals(ps.get(0).getNumID(), ps.get(1).getNumID());
                var lvl = d.getNumbering().getAbstractNum(d.getNumbering().getNum(ps.get(0).getNumID()).getCTNum().getAbstractNumId().getVal()).getAbstractNum().getLvlArray(0);
        assertEquals("bullet", lvl.getNumFmt().getVal().toString());
    }

    @Test void orderedListsRestartAtOneEachTime() throws Exception {
        var d = one("<ol><li><p>a</p></li></ol><p>x</p><ol><li><p>b</p></li></ol>");
        var ps = framed(d);
        var n1 = ps.get(0).getNumID(); var n2 = ps.get(2).getNumID();
        assertNotEquals(n1, n2, "second list needs its own num instance to restart numbering");
        var ct = d.getNumbering().getNum(n2).getCTNum();
        assertEquals(1, ct.getLvlOverrideArray(0).getStartOverride().getVal().intValue());
        var abs = d.getNumbering().getAbstractNum(ct.getAbstractNumId().getVal()).getAbstractNum();
        assertEquals("decimal", abs.getLvlArray(0).getNumFmt().getVal().toString());
    }

    @Test void nestedListIncreasesLevel() throws Exception {
        var d = one("<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>");
        var ps = framed(d);
        assertEquals(0, ps.get(0).getNumIlvl().intValue()); assertEquals(1, ps.get(1).getNumIlvl().intValue());
    }

    @Test void linkBecomesHyperlinkAndUnsafeSchemesAreDropped() throws Exception {
        var d = one("<p><a href=\"https://example.com/x\">ok</a><a href=\"javascript:alert(1)\">bad</a></p>");
        var p = framed(d).get(0);
        var hl = p.getRuns().stream().filter(r -> r instanceof XWPFHyperlinkRun).map(r -> (XWPFHyperlinkRun) r).toList();
        assertEquals(1, hl.size());
        assertEquals("https://example.com/x", d.getHyperlinkByID(hl.get(0).getHyperlinkId()).getURL());
        assertEquals("ok", hl.get(0).text());
        assertEquals("bad", run(d, "bad").text());   // text kept, link removed
    }

    @Test void lineBreakAndBlockquoteAndCode() throws Exception {
        var d = one("<p>a<br>b</p><blockquote><p>q</p></blockquote><p><code>c</code></p>");
        assertTrue(framed(d).get(0).getCTP().xmlText().contains("<w:br/>"));
        assertTrue(framed(d).get(1).getCTP().getPPr().isSetPBdr());
        assertEquals("Courier New", run(d, "c").getFontFamily());
    }

    @Test void lineHeightIsApplied() throws Exception {
        Element e = text("<p>x</p>", 0, 0, 100, 50); e.lineHeight = 1.5;
        var d = build(template(e));
        assertEquals(360, n(framed(d).get(0).getCTP().getPPr().getSpacing().getLine()));
    }

    @Test void variablesAreSubstitutedAndEscaped() throws Exception {
        var d = one("<p>Date {{date}} / {{from}} -> {{to}}</p>");
        assertEquals("Date 2026-01-02 / now-6h -> now", framed(d).get(0).getText());
    }

    @Test void whitespaceAndUnicodeArePreserved() throws Exception {
        var d = one("<p>Привет, <strong>мир</strong> &amp; &lt;tag&gt;</p>");
        assertEquals("Привет, мир & <tag>", framed(d).get(0).getText());
    }

    @Test void emptyTextBoxStillProducesAFrame() throws Exception {
        assertEquals(1, framed(build(template(text("", 5, 5, 50, 50)))).size());
    }

    @Test void chartBecomesFloatingPictureAnchoredToPage() throws Exception {
        Element c = chart("abc", 1, 50, 100, 400, 200);
        Map<Element, DocxBuilder.Image> imgs = new IdentityHashMap<>();
        imgs.put(c, new DocxBuilder.Image(FakeGrafana.png(800, 400, "x"), Document.PICTURE_TYPE_PNG));
        var d = build(template(c), imgs);
        String xml = d.getDocument().xmlText();
        assertTrue(xml.contains("<wp:anchor"), "must be a floating anchor, not inline");
        assertFalse(xml.contains("<wp:inline"));
        assertTrue(xml.contains("relativeFrom=\"page\""));
        assertTrue(xml.contains("<wp:posOffset>" + 50 * 12700 + "</wp:posOffset>"));
        assertTrue(xml.contains("<wp:posOffset>" + 100 * 12700 + "</wp:posOffset>"));
        assertTrue(xml.contains("cx=\"" + 400 * 12700 + "\"") && xml.contains("cy=\"" + 200 * 12700 + "\""));
        assertTrue(xml.contains("<wp:wrapNone/>"));
        assertEquals(1, d.getAllPictures().size());
    }

    @Test void textOverChartPutsChartBehindText() throws Exception {
        Element c = chart("abc", 1, 0, 0, 300, 300); c.z = 0;
        Element t = text("<p>caption</p>", 10, 10, 100, 30); t.z = 5;
        Map<Element, DocxBuilder.Image> imgs = new IdentityHashMap<>();
        imgs.put(c, new DocxBuilder.Image(FakeGrafana.png(10, 10, "x"), Document.PICTURE_TYPE_PNG));
        assertTrue(build(template(c, t), imgs).getDocument().xmlText().contains("behindDoc=\"true\""));
        t.z = -1;
        assertTrue(build(template(c, t), imgs).getDocument().xmlText().contains("behindDoc=\"false\""));
    }

    @Test void multiplePagesStartOnNewPages() throws Exception {
        Template t = template(text("<p>one</p>", 0, 0, 100, 30));
        Template.Page p2 = new Template.Page(); p2.elements.add(text("<p>two</p>", 0, 0, 100, 30)); t.pages.add(p2);
        var d = build(t);
        long breaks = d.getParagraphs().stream().filter(XWPFParagraph::isPageBreak).count();
        assertEquals(1, breaks);
        String xml = d.getDocument().xmlText();
        assertTrue(xml.indexOf(">one<") < xml.indexOf("pageBreakBefore") && xml.indexOf("pageBreakBefore") < xml.indexOf(">two<"));
    }

    @Test void pageSizeAndLandscape() throws Exception {
        Template t = template(text("<p>x</p>", 0, 0, 10, 10)); t.pageWidth = 841.89; t.pageHeight = 595.28;
        var sz = build(t).getDocument().getBody().getSectPr().getPgSz();
        assertEquals(16838, n(sz.getW())); assertEquals(11906, n(sz.getH()));
        assertEquals("landscape", sz.getOrient().toString());
    }

    @Test void positionsAcrossManyElementsAreIndependent() throws Exception {
        var d = build(template(text("<p>a</p>", 10, 20, 100, 30), text("<p>b</p>", 300, 400, 120, 40)));
        var fs = framed(d);
        assertEquals(200, n(fs.get(0).getCTP().getPPr().getFramePr().getX()));
        assertEquals(6000, n(fs.get(1).getCTP().getPPr().getFramePr().getX()));
        assertEquals(8000, n(fs.get(1).getCTP().getPPr().getFramePr().getY()));
    }

    @Test void documentTitleFromTemplate() throws Exception {
        assertEquals("Test", build(template(text("<p>x</p>", 0, 0, 10, 10))).getProperties().getCoreProperties().getTitle());
    }

    // ---------- captions ----------
    static Element captioned(Element e, String text, String pos) { e.caption = new Template.Caption(); e.caption.text = text; e.caption.position = pos; return e; }
    static Map<Element, DocxBuilder.Image> pics(Element... els) {
        Map<Element, DocxBuilder.Image> m = new IdentityHashMap<>();
        for (Element e : els) m.put(e, new DocxBuilder.Image(FakeGrafana.png(40, 20, "x"), Document.PICTURE_TYPE_PNG));
        return m;
    }
    static String plain(XWPFDocument d) { return d.getDocument().xmlText().replaceAll("<w:instrText[^>]*>[^<]*</w:instrText>", "").replaceAll("<[^>]+>", ""); }

    @Test void captionIsARealSeqFieldWithCachedNumberAndCustomText() throws Exception {
        Element c = captioned(chart("abc", 1, 50, 100, 300, 200), "Загрузка CPU", "below");
        var d = build(template(c), pics(c));
        String xml = d.getDocument().xmlText();
        assertTrue(xml.contains("SEQ Рисунок \\* ARABIC"), "numbering must be a Word SEQ field");
        assertTrue(xml.contains("w:fldCharType=\"begin\"") && xml.contains("w:fldCharType=\"separate\"") && xml.contains("w:fldCharType=\"end\""));
        assertTrue(plain(d).contains("Рисунок 1 \u2014 Загрузка CPU"), plain(d));
        var fr = framed(d).get(framed(d).size() - 1).getCTP().getPPr();
        assertEquals(300 * 20, n(fr.getFramePr().getW())); assertEquals(22 * 20, n(fr.getFramePr().getH()));
        assertEquals(50 * 20, n(fr.getFramePr().getX())); assertEquals((100 + 200 - 22) * 20, n(fr.getFramePr().getY()), "caption sits at the bottom of the element box");
        assertEquals(ParagraphAlignment.CENTER, framed(d).get(framed(d).size() - 1).getAlignment());
    }

    @Test void picturesShrinkByTheCaptionHeightAndAboveCaptionsMovePictureDown() throws Exception {
        Element below = captioned(chart("abc", 1, 50, 100, 300, 200), "b", "below"), above = captioned(chart("abc", 2, 400, 100, 150, 200), "a", "above"), none = chart("abc", 3, 50, 400, 300, 100);
        String xml = build(template(below, above, none), pics(below, above, none)).getDocument().xmlText();
        assertTrue(xml.contains("cy=\"" + 178 * 12700 + "\""), "pictures with captions are 22pt shorter");
        assertTrue(xml.contains("cy=\"" + 100 * 12700 + "\""), "pictures without a caption keep their size");
        var ys = java.util.regex.Pattern.compile("relativeFrom=\"page\"><wp:posOffset>(\\d+)</wp:posOffset></wp:positionV>").matcher(xml);
        java.util.List<Long> v = new java.util.ArrayList<>(); while (ys.find()) v.add(Long.parseLong(ys.group(1)));
        assertTrue(v.contains(100L * 12700), "below: picture stays at the top"); assertTrue(v.contains(122L * 12700), "above: picture moves down by the caption height");
    }

    @Test void numbersFollowReadingOrderNotInsertionOrderAndLabelIsConfigurable() throws Exception {
        Element second = captioned(chart("abc", 2, 300, 100, 200, 100), "right", "below"), first = captioned(chart("abc", 1, 20, 100, 200, 100), "left", "below");
        Template t = template(second, first); t.captionLabel = "Рис.";
        var d = build(t, pics(first, second));
        String text = plain(d);
        assertTrue(text.indexOf("Рис. 1 \u2014 left") >= 0 && text.indexOf("Рис. 2 \u2014 right") > text.indexOf("Рис. 1 \u2014 left"), text);
        assertTrue(d.getDocument().xmlText().contains("SEQ Рис \\* ARABIC"));
    }

    @Test void emptyCaptionTextGivesJustTheNumberAndVariablesAreSubstituted() throws Exception {
        Element a = captioned(chart("abc", 1, 20, 100, 200, 100), "", "below"), b = captioned(chart("abc", 2, 20, 300, 200, 100), "Период {{from}} - {{to}} & ok", "below");
        String text = plain(build(template(a, b), pics(a, b)));
        assertTrue(text.contains("Рисунок 1") && !text.contains("Рисунок 1 \u2014"), text);
        assertTrue(text.contains("Рисунок 2 \u2014 Период now-6h - now &amp; ok"), text);   // XML-escaped in the file
    }

    @Test void captionsOnTwoPagesContinueNumbering() throws Exception {
        Element a = captioned(chart("abc", 1, 20, 100, 200, 100), "one", "below"); Template t = template(a);
        Template.Page p2 = new Template.Page(); Element b = captioned(chart("abc", 2, 20, 100, 200, 100), "two", "below"); p2.elements.add(b); t.pages.add(p2);
        String text = plain(build(t, pics(a, b)));
        assertTrue(text.contains("Рисунок 1 \u2014 one") && text.contains("Рисунок 2 \u2014 two"));
    }

    /** Writes target/visual-sample.docx for manual / LibreOffice inspection. */
    @Test void writeVisualSample() throws Exception {
        Element title = text("<h1 style=\"text-align:center\">Weekly report {{date}}</h1>", 40, 30, 515, 40);
        Element rich = text("<p>Normal <strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <span style=\"color:#d14343\">red</span> " +
            "<mark style=\"background-color:#ffe066\">highlight</mark> H<sub>2</sub>O x<sup>2</sup> <a href=\"https://grafana.com\">link</a></p>" +
            "<ul><li><p>First bullet</p></li><li><p>Second</p><ul><li><p>Nested</p></li></ul></li></ul><ol><li><p>One</p></li><li><p>Two</p></li></ol>" +
            "<p style=\"text-align:right\"><span style=\"font-family:Georgia;font-size:16px\">Right aligned Georgia 16</span></p>", 40, 90, 250, 300);
        Element c1 = chart("abc", 1, 310, 90, 245, 150), c2 = chart("abc", 2, 310, 250, 245, 150), c3 = chart("abc", 3, 40, 420, 515, 200);
        Element over = text("<p style=\"text-align:center\"><strong><span style=\"color:#ffffff\">Text over chart</span></strong></p>", 60, 480, 475, 30); over.z = 10;
        Template t = template(title, rich, c1, c2, c3, over);
        Template.Page p2 = new Template.Page(); p2.elements.add(text("<h2>Page two</h2><p>Second page content</p>", 72, 72, 300, 80)); t.pages.add(p2);
        Map<Element, DocxBuilder.Image> imgs = new IdentityHashMap<>();
        for (Element c : List.of(c1, c2, c3)) imgs.put(c, new DocxBuilder.Image(FakeGrafana.png((int) (c.w * 3), (int) (c.h * 3), "chart"), Document.PICTURE_TYPE_PNG));
        java.nio.file.Files.write(java.nio.file.Path.of("target/visual-sample.docx"), new DocxBuilder(t, imgs, VARS).build());
    }
}
