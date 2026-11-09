package com.example.reporter;

import com.example.reporter.grafana.BlockFactory;
import com.example.reporter.grafana.GrafanaClient.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class BlockFactoryTest {
    @Test void mirrorsDashboardGridScaledToBlockWidth() {
        var d = new Dashboard("u", "Linux", "linux", List.of(
                new PanelInfo(1, "CPU", "timeseries", 0, 0, 12, 8), new PanelInfo(2, "Mem", "gauge", 12, 0, 12, 8),
                new PanelInfo(3, "Disk", "bargauge", 0, 8, 24, 6)), List.of(new Variable("host", "Host", "query", "a", List.of("a", "b"))));
        var b = BlockFactory.fromDashboard(d, 480);   // 480/24 = 20pt per column, 15.2pt per row
        assertEquals(3, b.charts.size());
        assertEquals(0, b.charts.get(0).x); assertEquals(240, b.charts.get(0).w);
        assertEquals(240, b.charts.get(1).x);
        assertEquals(15.2 * 8, b.charts.get(2).y, 0.1); assertEquals(480, b.charts.get(2).w);
        assertEquals(15.2 * 14, b.height, 0.2);
        assertEquals("Linux", b.name); assertEquals("host", b.variables.get(0).name); assertEquals("a", b.variables.get(0).defaultValue); assertEquals(List.of("a", "b"), b.variables.get(0).options);
    }
}
