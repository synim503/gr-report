package com.example.reporter;

import com.example.reporter.docx.Captions;
import com.example.reporter.model.Template;
import com.example.reporter.model.Template.Element;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static com.example.reporter.TestUtil.*;
import static org.junit.jupiter.api.Assertions.*;

class CaptionsTest {
    static Element cap(Element e, String text) { e.caption = new Template.Caption(); e.caption.text = text; return e; }

    @Test void numbersFollowReadingOrderRowsThenColumns() {
        Element br = cap(chart("a", 4, 300, 400, 100, 50), "d"), tl = cap(chart("a", 1, 20, 100, 100, 50), "a");
        Element tr = cap(chart("a", 2, 300, 104, 100, 50), "b");       // top is 4 pt lower than tl's: same row, so it comes after tl by x
        Element bl = cap(chart("a", 3, 20, 400, 100, 50), "c");
        Template t = template(br, tr, tl, bl);
        Map<Element, Integer> n = Captions.number(t);
        assertEquals(1, n.get(tl)); assertEquals(2, n.get(tr)); assertEquals(3, n.get(bl)); assertEquals(4, n.get(br));
    }

    @Test void rowsAreSeparatedByTolerance() {
        Element left = cap(chart("a", 1, 20, 100, 100, 50), "l"), rightHigher = cap(chart("a", 2, 300, 92.5, 100, 50), "r");
        // 92.5 sorts first; left is 7.5 below it -> same row -> ordered by x: left, right
        Map<Element, Integer> n = Captions.number(template(left, rightHigher));
        assertEquals(1, n.get(left)); assertEquals(2, n.get(rightHigher));
        Element far = cap(chart("a", 3, 20, 100.0 + 9, 100, 50), "far");                        // 9 pt below the anchor: next row
        Element topRight = cap(chart("a", 4, 300, 100, 100, 50), "tr");
        Map<Element, Integer> m = Captions.number(template(far, topRight, left));
        assertEquals(1, m.get(left)); assertEquals(2, m.get(topRight)); assertEquals(3, m.get(far));
    }

    @Test void numberingContinuesAcrossPagesAndSkipsUncaptionedElements() {
        Element a = cap(chart("a", 1, 10, 10, 100, 50), "p1"), plain = chart("a", 2, 10, 100, 100, 50);
        Element txt = text("<p>x</p>", 10, 200, 100, 30); txt.caption = new Template.Caption();     // text blocks never get a figure number
        Template t = template(a, plain, txt);
        Template.Page p2 = new Template.Page(); Element b = cap(chart("a", 3, 10, 10, 100, 50), "p2"); p2.elements.add(b); t.pages.add(p2);
        Map<Element, Integer> n = Captions.number(t);
        assertEquals(2, n.size()); assertEquals(1, n.get(a)); assertEquals(2, n.get(b));
    }

    @Test void pictureAndCaptionBoxesSplitTheElement() {
        Element e = cap(chart("a", 1, 50, 100, 300, 200), "x");
        var pic = Captions.pictureBox(e); var cb = Captions.captionBox(e);
        assertEquals(100, pic.y); assertEquals(178, pic.h); assertEquals(278, cb.y); assertEquals(22, cb.h);
        e.caption.position = "above";
        pic = Captions.pictureBox(e); cb = Captions.captionBox(e);
        assertEquals(100, cb.y); assertEquals(122, pic.y); assertEquals(178, pic.h);
        assertSame(chart("a", 1, 0, 0, 1, 1).caption, null);
        Element plain = chart("a", 1, 0, 0, 100, 80); assertSame(plain, Captions.pictureBox(plain));
    }

    @Test void seqNameKeepsLettersOnly() {
        assertEquals("Рисунок", Captions.seqName("Рисунок")); assertEquals("Рис", Captions.seqName("Рис.")); assertEquals("Figure", Captions.seqName("1.2"));
        assertEquals(List.of(), List.of());
    }
}
