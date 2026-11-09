package com.example.reporter.docx;

import com.example.reporter.model.Template;
import com.example.reporter.model.Template.Element;
import com.example.reporter.model.Template.Page;
import org.apache.poi.xwpf.usermodel.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;
import org.openxmlformats.schemas.drawingml.x2006.main.CTGraphicalObject;
import org.openxmlformats.schemas.drawingml.x2006.main.CTPoint2D;
import org.openxmlformats.schemas.drawingml.x2006.main.CTPositiveSize2D;
import org.openxmlformats.schemas.drawingml.x2006.wordprocessingDrawing.*;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigInteger;
import java.util.*;

/**
 * Builds a .docx whose pages replicate the editor layout:
 *  - text elements become absolutely positioned Word frames (w:framePr, anchored to the page);
 *  - charts / images become floating pictures (wp:anchor, positioned relative to the page).
 */
public class DocxBuilder {
    public record Image(byte[] data, int pictureType) {}

    private static final String DEFAULT_FONT = "Arial";
    private static final double DEFAULT_SIZE = 11;
    private static final Set<String> BLOCK = Set.of("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
            "blockquote", "pre", "hr", "table");

    private final Template template;
    private final Map<Element, Image> images;
    private final Map<String, String> vars;
    private XWPFDocument doc;
    private XWPFNumbering numbering;
    private int docPrId = 1;
    private Map<Element, Integer> figureNumbers = Map.of();

    public DocxBuilder(Template template, Map<Element, Image> images, Map<String, String> vars) {
        this.template = template;
        this.images = images;
        this.vars = vars;
    }

    public byte[] build() throws IOException {
        doc = new XWPFDocument();
        try {
            setupSection();
            setupNumbering();
            doc.getProperties().getCoreProperties().setTitle(template.name);
            doc.getProperties().getCoreProperties().setCreator("Grafana Reporter");
            figureNumbers = Captions.number(template);
            List<Page> pages = template.pages;
            for (int i = 0; i < pages.size(); i++) renderPage(pages.get(i), i);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.write(out);
            return out.toByteArray();
        } finally {
            doc.close();
        }
    }

    // ---------- document scaffolding ----------

    private void setupSection() {
        CTSectPr sp = doc.getDocument().getBody().isSetSectPr() ? doc.getDocument().getBody().getSectPr()
                : doc.getDocument().getBody().addNewSectPr();
        CTPageSz sz = sp.isSetPgSz() ? sp.getPgSz() : sp.addNewPgSz();
        sz.setW(BigInteger.valueOf(Units.twips(template.pageWidth)));
        sz.setH(BigInteger.valueOf(Units.twips(template.pageHeight)));
        if (template.pageWidth > template.pageHeight) sz.setOrient(STPageOrientation.LANDSCAPE);
        CTPageMar mar = sp.isSetPgMar() ? sp.getPgMar() : sp.addNewPgMar();
        BigInteger m = BigInteger.valueOf(360); // 0.25in – elements are absolutely positioned, margins only host the anchors
        mar.setTop(m); mar.setBottom(m); mar.setLeft(m); mar.setRight(m);
        mar.setHeader(BigInteger.ZERO); mar.setFooter(BigInteger.ZERO); mar.setGutter(BigInteger.ZERO);
    }

    private static final String W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private BigInteger bulletAbs = BigInteger.ZERO, decimalAbs = BigInteger.ONE, bulletNum;

    private void setupNumbering() throws IOException {
        numbering = doc.createNumbering();
        numbering.addAbstractNum(abstractNum(0, true));
        numbering.addAbstractNum(abstractNum(1, false));
        bulletNum = numbering.addNum(bulletAbs);
    }

    private XWPFAbstractNum abstractNum(int id, boolean bullet) throws IOException {
        String[] bullets = {"•", "o", "▪"};
        String[] fmts = {"decimal", "lowerLetter", "lowerRoman"};
        StringBuilder sb = new StringBuilder("<w:numbering xmlns:w=\"" + W + "\"><w:abstractNum w:abstractNumId=\"" + id + "\">")
                .append("<w:multiLevelType w:val=\"hybridMultilevel\"/>");
        for (int l = 0; l < 3; l++) {
            sb.append("<w:lvl w:ilvl=\"").append(l).append("\"><w:start w:val=\"1\"/>")
              .append("<w:numFmt w:val=\"").append(bullet ? "bullet" : fmts[l]).append("\"/>")
              .append("<w:lvlText w:val=\"").append(bullet ? bullets[l] : "%" + (l + 1) + ".").append("\"/>")
              .append("<w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"").append(360 * (l + 1)).append("\" w:hanging=\"360\"/></w:pPr>");
            if (bullet) sb.append("<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\" w:hint=\"default\"/></w:rPr>");
            sb.append("</w:lvl>");
        }
        sb.append("</w:abstractNum></w:numbering>");
        try {
            CTAbstractNum ct = NumberingDocument.Factory.parse(sb.toString()).getNumbering().getAbstractNumArray(0);
            return new XWPFAbstractNum(ct);
        } catch (org.apache.xmlbeans.XmlException e) { throw new IOException(e); }
    }

    /** Fresh numbering instance so each ordered list restarts at 1. */
    private BigInteger newDecimalNum() {
        BigInteger id = numbering.addNum(decimalAbs);
        CTNum ct = numbering.getNum(id).getCTNum();
        for (int l = 0; l < 3; l++) {
            CTNumLvl o = ct.addNewLvlOverride();
            o.setIlvl(BigInteger.valueOf(l));
            o.addNewStartOverride().setVal(BigInteger.ONE);
        }
        return id;
    }

    // ---------- pages ----------

    private void renderPage(Page page, int index) throws IOException {
        List<Element> els = new ArrayList<>(page.elements);
        els.sort(Comparator.comparingInt(e -> e.z));

        XWPFParagraph host = doc.createParagraph();
        if (index > 0) host.setPageBreak(true);
        tinyParagraph(host);

        int rel = 251658240;
        for (Element e : els) {
            if (e.type == Template.Type.text) continue;
            Image img = images.get(e);
            if (img == null) continue;
            XWPFRun run = host.createRun();
            boolean behind = els.stream().anyMatch(t -> t.type == Template.Type.text && t.z > e.z && overlaps(t, e));
            addAnchoredPicture(run, img, Captions.pictureBox(e), behind, rel + e.z);
        }
        for (Element e : els) {
            if (e.type != Template.Type.text) continue;
            renderText(e);
            tinyParagraph(doc.createParagraph());   // separates neighbouring frames
        }
        for (Element e : Captions.ordered(page.elements)) {      // numbering order == SEQ field order in the document
            renderCaption(e, figureNumbers.get(e));
            tinyParagraph(doc.createParagraph());
        }
    }

    /** "Рисунок {SEQ} — text" as a frame under (or above) the picture; the number is a real Word SEQ field. */
    private void renderCaption(Element e, int number) {
        Element box = Captions.captionBox(e);
        RunStyle base = new RunStyle(false, false, false, false, null, null, 10, DEFAULT_FONT, null, null);
        XWPFParagraph p = newParagraph(new Ctx(box, null, -1, "center", false), base);
        p.setSpacingAfter(0);
        RunStyle bold = base.with(b -> { b.bold = true; return b; });
        String label = template.captionLabel == null || template.captionLabel.isBlank() ? "Рисунок" : template.captionLabel.trim();
        addText(p, label + " ", bold);
        field(p, " SEQ " + Captions.seqName(label) + " \\* ARABIC ", String.valueOf(number), bold);
        String text = e.caption.text == null ? "" : e.caption.text.trim();
        if (!text.isEmpty()) addText(p, " \u2014 " + stripTags(substitute(text)), base);
    }

    private static String stripTags(String s) { return s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"); }

    /** Complex field (begin / instruction / separate / cached result / end) so Word can update the numbering. */
    private void field(XWPFParagraph p, String instr, String cached, RunStyle st) {
        XWPFRun r = p.createRun(); r.getCTR().addNewFldChar().setFldCharType(STFldCharType.BEGIN);
        r = p.createRun(); CTText it = r.getCTR().addNewInstrText(); it.setStringValue(instr); it.setSpace(org.apache.xmlbeans.impl.xb.xmlschema.SpaceAttribute.Space.PRESERVE);
        r = p.createRun(); r.getCTR().addNewFldChar().setFldCharType(STFldCharType.SEPARATE);
        addText(p, cached, st);
        r = p.createRun(); r.getCTR().addNewFldChar().setFldCharType(STFldCharType.END);
    }

    private static boolean overlaps(Element a, Element b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    private void tinyParagraph(XWPFParagraph p) {
        p.setSpacingAfter(0);
        p.setSpacingBefore(0);
        CTPPr ppr = p.getCTP().isSetPPr() ? p.getCTP().getPPr() : p.getCTP().addNewPPr();
        CTSpacing sp = ppr.isSetSpacing() ? ppr.getSpacing() : ppr.addNewSpacing();
        sp.setLine(BigInteger.valueOf(20));
        sp.setLineRule(STLineSpacingRule.EXACT);
        markSize(p, 1);
    }

    private void markSize(XWPFParagraph p, double pt) {
        CTPPr ppr = p.getCTP().isSetPPr() ? p.getCTP().getPPr() : p.getCTP().addNewPPr();
        CTParaRPr rpr = ppr.isSetRPr() ? ppr.getRPr() : ppr.addNewRPr();
        (rpr.sizeOfSzArray() > 0 ? rpr.getSzArray(0) : rpr.addNewSz()).setVal(BigInteger.valueOf(Math.round(pt * 2)));
    }

    // ---------- pictures ----------

    private void addAnchoredPicture(XWPFRun run, Image img, Element e, boolean behind, int relativeHeight) throws IOException {
        try {
            run.addPicture(new ByteArrayInputStream(img.data()), img.pictureType(), "element-" + docPrId + ".png",
                    (int) Units.emu(e.w), (int) Units.emu(e.h));
        } catch (org.apache.poi.openxml4j.exceptions.InvalidFormatException ex) { throw new IOException(ex); }
        CTDrawing drawing = run.getCTR().getDrawingArray(0);
        CTInline inline = drawing.getInlineArray(0);
        CTGraphicalObject graphic = (CTGraphicalObject) inline.getGraphic().copy();
        String name = "Picture " + docPrId;
        drawing.removeInline(0);

        CTAnchor a = drawing.addNewAnchor();
        a.setDistT(0L); a.setDistB(0L); a.setDistL(0L); a.setDistR(0L);
        a.setSimplePos2(false);
        a.setRelativeHeight(relativeHeight);
        a.setBehindDoc(behind);
        a.setLocked(false);
        a.setLayoutInCell(true);
        a.setAllowOverlap(true);
        CTPoint2D sp = a.addNewSimplePos(); sp.setX(0L); sp.setY(0L);
        CTPosH ph = a.addNewPositionH(); ph.setRelativeFrom(STRelFromH.PAGE); ph.setPosOffset((int) Units.emu(e.x));
        CTPosV pv = a.addNewPositionV(); pv.setRelativeFrom(STRelFromV.PAGE); pv.setPosOffset((int) Units.emu(e.y));
        CTPositiveSize2D ext = a.addNewExtent(); ext.setCx(Units.emu(e.w)); ext.setCy(Units.emu(e.h));
        CTEffectExtent ee = a.addNewEffectExtent(); ee.setL(0); ee.setT(0); ee.setR(0); ee.setB(0);
        a.addNewWrapNone();
        org.openxmlformats.schemas.drawingml.x2006.main.CTNonVisualDrawingProps dp = a.addNewDocPr();
        dp.setId(docPrId++); dp.setName(name);
        a.addNewCNvGraphicFramePr();
        a.setGraphic(graphic);
    }

    // ---------- text ----------

    private record RunStyle(boolean bold, boolean italic, boolean underline, boolean strike, String color, String shade,
                            double size, String font, VerticalAlign vert, String link) {
        RunStyle with(java.util.function.UnaryOperator<Builder> f) {
            Builder b = new Builder(this); return f.apply(b).build();
        }
    }
    private static final class Builder {
        boolean bold, italic, underline, strike; String color, shade, font, link; double size; VerticalAlign vert;
        Builder(RunStyle s) { bold = s.bold; italic = s.italic; underline = s.underline; strike = s.strike; color = s.color;
            shade = s.shade; font = s.font; link = s.link; size = s.size; vert = s.vert; }
        RunStyle build() { return new RunStyle(bold, italic, underline, strike, color, shade, size, font, vert, link); }
    }

    /** Per-text-element context. */
    private record Ctx(Element el, BigInteger numId, int level, String blockAlign, boolean quote) {}

    private void renderText(Element e) {
        String html = substitute(e.html == null ? "" : e.html);
        org.jsoup.nodes.Element body = Jsoup.parseBodyFragment(html).body();
        RunStyle base = new RunStyle(false, false, false, false, null, null, DEFAULT_SIZE, DEFAULT_FONT, null, null);
        int before = doc.getParagraphs().size();
        blocks(body, new Ctx(e, null, -1, null, false), base);
        if (doc.getParagraphs().size() == before) {          // empty text box still occupies its frame
            XWPFParagraph p = newParagraph(new Ctx(e, null, -1, null, false), base);
        }
    }

    private String substitute(String html) {
        for (var en : vars.entrySet()) html = html.replace("{{" + en.getKey() + "}}", escape(en.getValue()));
        return html;
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private void blocks(org.jsoup.nodes.Element container, Ctx ctx, RunStyle base) {
        List<Node> inlineRun = new ArrayList<>();
        for (Node n : container.childNodes()) {
            if (n instanceof org.jsoup.nodes.Element el && BLOCK.contains(el.tagName())) {
                flushInline(inlineRun, ctx, base);
                block(el, ctx, base);
            } else if (n instanceof TextNode t && t.isBlank()) {
                if (!inlineRun.isEmpty()) inlineRun.add(n);
            } else inlineRun.add(n);
        }
        flushInline(inlineRun, ctx, base);
    }

    private void flushInline(List<Node> nodes, Ctx ctx, RunStyle base) {
        if (nodes.isEmpty()) return;
        XWPFParagraph p = newParagraph(ctx, base);
        for (Node n : nodes) inline(p, n, base, false);
        nodes.clear();
    }

    private void block(org.jsoup.nodes.Element el, Ctx ctx, RunStyle base) {
        String tag = el.tagName();
        switch (tag) {
            case "ul", "ol" -> {
                BigInteger num = "ul".equals(tag) ? bulletNum : newDecimalNum();
                int level = Math.min(ctx.level() + 1, 2);
                for (org.jsoup.nodes.Element li : el.children()) {
                    if (!"li".equals(li.tagName())) continue;
                    listItem(li, new Ctx(ctx.el(), num, level, ctx.blockAlign(), ctx.quote()), base);
                }
            }
            case "li" -> listItem(el, ctx, base);
            case "hr" -> {
                XWPFParagraph p = newParagraph(ctx, base);
                CTPBdr b = p.getCTP().getPPr().addNewPBdr();
                CTBorder bt = b.addNewBottom(); bt.setVal(STBorder.SINGLE); bt.setSz(BigInteger.valueOf(6)); bt.setColor("808080");
            }
            case "table" -> { /* tables are not supported inside text frames; keep cell text */
                for (org.jsoup.nodes.Element tr : el.select("tr")) {
                    XWPFParagraph p = newParagraph(ctx, base);
                    String sep = "";
                    for (org.jsoup.nodes.Element td : tr.children()) { addText(p, sep + td.text(), base); sep = "\t"; }
                }
            }
            default -> {
                boolean hasBlockChild = el.children().stream().anyMatch(c -> BLOCK.contains(c.tagName()));
                String align = textAlign(el, ctx.blockAlign());
                boolean quote = ctx.quote() || "blockquote".equals(tag);
                Ctx c2 = new Ctx(ctx.el(), ctx.numId(), ctx.level(), align, quote);
                RunStyle bs = base;
                int heading = 0;
                if (tag.matches("h[1-6]")) {
                    heading = tag.charAt(1) - '0';
                    double[] sizes = {24, 18, 14, 12, 11, 10};
                    final double sz = sizes[heading - 1];
                    bs = base.with(b -> { b.bold = true; b.size = sz; return b; });
                }
                if ("pre".equals(tag)) bs = bs.with(b -> { b.font = "Courier New"; return b; });
                if (hasBlockChild) { blocks(el, c2, bs); return; }
                XWPFParagraph p = newParagraph(c2, bs);
                if (heading > 0) p.getCTP().getPPr().addNewOutlineLvl().setVal(BigInteger.valueOf(heading - 1));
                for (Node n : el.childNodes()) inline(p, n, bs, "pre".equals(tag));
            }
        }
    }

    private void listItem(org.jsoup.nodes.Element li, Ctx ctx, RunStyle base) {
        List<Node> inlineRun = new ArrayList<>();
        boolean first = true;
        for (Node n : li.childNodes()) {
            if (n instanceof org.jsoup.nodes.Element el && ("ul".equals(el.tagName()) || "ol".equals(el.tagName()))) {
                flushInline(inlineRun, ctx, base);
                block(el, ctx, base);
            } else if (n instanceof org.jsoup.nodes.Element el && "p".equals(el.tagName())) {
                flushInline(inlineRun, ctx, base);
                Ctx c2 = new Ctx(ctx.el(), first ? ctx.numId() : ctx.numId(), ctx.level(), textAlign(el, ctx.blockAlign()), ctx.quote());
                XWPFParagraph p = newParagraph(c2, base);
                for (Node k : el.childNodes()) inline(p, k, base, false);
                first = false;
            } else inlineRun.add(n);
        }
        flushInline(inlineRun, ctx, base);
    }

    private static String textAlign(org.jsoup.nodes.Element el, String inherited) {
        String a = CssUtil.parse(el.attr("style")).get("text-align");
        return a != null ? a.toLowerCase() : (el.hasAttr("align") ? el.attr("align").toLowerCase() : inherited);
    }

    /** Creates a paragraph that carries the element's frame (position/size on the page). */
    private XWPFParagraph newParagraph(Ctx ctx, RunStyle base) {
        XWPFParagraph p = doc.createParagraph();
        Element e = ctx.el();
        CTPPr ppr = p.getCTP().isSetPPr() ? p.getCTP().getPPr() : p.getCTP().addNewPPr();
        CTFramePr fr = ppr.addNewFramePr();
        fr.setW(BigInteger.valueOf(Units.twips(e.w)));
        fr.setH(BigInteger.valueOf(Units.twips(e.h)));
        fr.setHRule(STHeightRule.AT_LEAST);
        fr.setX(BigInteger.valueOf(Units.twips(e.x)));
        fr.setY(BigInteger.valueOf(Units.twips(e.y)));
        fr.setHAnchor(STHAnchor.PAGE);
        fr.setVAnchor(STVAnchor.PAGE);
        fr.setWrap(STWrap.AROUND);
        fr.setHSpace(BigInteger.ZERO);
        fr.setVSpace(BigInteger.ZERO);

        p.setSpacingAfter(ctx.numId() != null ? 40 : 80);
        p.setSpacingBefore(0);
        p.setSpacingBetween(e.lineHeight > 0 ? e.lineHeight : 1.0, LineSpacingRule.AUTO);
        if (ctx.numId() != null) {
            p.setNumID(ctx.numId());
            p.setNumILvl(BigInteger.valueOf(Math.max(ctx.level(), 0)));
        }
        if (ctx.quote()) {
            p.setIndentationLeft(540);
            CTPBdr b = ppr.addNewPBdr();
            CTBorder l = b.addNewLeft(); l.setVal(STBorder.SINGLE); l.setSz(BigInteger.valueOf(12)); l.setSpace(BigInteger.valueOf(8)); l.setColor("AAAAAA");
        }
        p.setAlignment(switch (ctx.blockAlign() == null ? "left" : ctx.blockAlign()) {
            case "center" -> ParagraphAlignment.CENTER;
            case "right" -> ParagraphAlignment.RIGHT;
            case "justify" -> ParagraphAlignment.BOTH;
            default -> ParagraphAlignment.LEFT;
        });
        markSize(p, base.size());
        return p;
    }

    private void inline(XWPFParagraph p, Node n, RunStyle st, boolean pre) {
        if (n instanceof TextNode t) {
            String text = pre ? t.getWholeText() : t.getWholeText().replaceAll("\\s+", " ");
            if (!text.isEmpty()) addText(p, text, st);
            return;
        }
        if (!(n instanceof org.jsoup.nodes.Element el)) return;
        String tag = el.tagName();
        if ("br".equals(tag)) { p.createRun().addBreak(); return; }
        RunStyle s = switch (tag) {
            case "strong", "b" -> st.with(b -> { b.bold = true; return b; });
            case "em", "i" -> st.with(b -> { b.italic = true; return b; });
            case "u" -> st.with(b -> { b.underline = true; return b; });
            case "s", "strike", "del" -> st.with(b -> { b.strike = true; return b; });
            case "sub" -> st.with(b -> { b.vert = VerticalAlign.SUBSCRIPT; return b; });
            case "sup" -> st.with(b -> { b.vert = VerticalAlign.SUPERSCRIPT; return b; });
            case "code" -> st.with(b -> { b.font = "Courier New"; return b; });
            case "a" -> st.with(b -> { b.link = el.attr("href"); return b; });
            case "mark" -> st.with(b -> { b.shade = "FFFF00"; return b; });
            default -> st;
        };
        Map<String, String> css = CssUtil.parse(el.attr("style"));
        if (!css.isEmpty() || "mark".equals(tag)) {
            String col = CssUtil.color(css.get("color"));
            String bg = CssUtil.color(css.getOrDefault("background-color", css.get("background")));
            Double sz = CssUtil.sizePt(css.get("font-size"));
            String font = CssUtil.firstFont(css.get("font-family"));
            String fw = css.get("font-weight"), fs = css.get("font-style"), td = css.get("text-decoration");
            s = s.with(b -> {
                if (col != null) b.color = col;
                if (bg != null) b.shade = bg;
                if (sz != null) b.size = sz;
                if (font != null) b.font = font;
                if (fw != null && (fw.equals("bold") || fw.matches("[6-9]00"))) b.bold = true;
                if ("italic".equals(fs)) b.italic = true;
                if (td != null && td.contains("underline")) b.underline = true;
                if (td != null && td.contains("line-through")) b.strike = true;
                return b;
            });
        }
        for (Node c : el.childNodes()) inline(p, c, s, pre);
    }

    private void addText(XWPFParagraph p, String text, RunStyle s) {
        XWPFRun r;
        if (s.link() != null && !s.link().isBlank() && safeLink(s.link())) {
            XWPFHyperlinkRun hr = p.createHyperlinkRun(s.link());
            r = hr;
            if (s.color() == null) r.setColor("0563C1");
            if (!s.underline()) r.setUnderline(UnderlinePatterns.SINGLE);
        } else r = p.createRun();
        String[] lines = text.split("\n", -1);
        for (int i = 0; i < lines.length; i++) { if (i > 0) r.addBreak(); r.setText(lines[i]); }
        r.setFontFamily(s.font());
        r.setFontSize(s.size());
        if (s.bold()) r.setBold(true);
        if (s.italic()) r.setItalic(true);
        if (s.underline()) r.setUnderline(UnderlinePatterns.SINGLE);
        if (s.strike()) r.setStrikeThrough(true);
        if (s.color() != null) r.setColor(s.color());
        if (s.vert() != null) r.setSubscript(s.vert());
        if (s.shade() != null) {
            CTShd shd = r.getCTR().getRPr().addNewShd();
            shd.setVal(STShd.CLEAR); shd.setColor("auto"); shd.setFill(s.shade());
        }
    }

    private static boolean safeLink(String href) {
        String h = href.trim().toLowerCase();
        return h.startsWith("http://") || h.startsWith("https://") || h.startsWith("mailto:");
    }
}
