package com.example.reporter.grafana;

import com.example.reporter.model.Block;

/** Builds a block preset from a Grafana dashboard, mirroring the dashboard's own grid (24 columns). */
public final class BlockFactory {
    private BlockFactory() {}

    public static Block fromDashboard(GrafanaClient.Dashboard d, double width) {
        Block b = new Block();
        b.name = d.title();
        b.dashboardUid = d.uid();
        b.dashboardTitle = d.title();
        b.width = width;
        double col = width / 24.0;
        double row = col * 0.76;                  // Grafana: ~38px row on ~50px column
        double maxY = 0;
        for (GrafanaClient.PanelInfo p : d.panels()) {
            Block.BlockChart c = new Block.BlockChart();
            c.panelId = p.id();
            c.title = p.title();
            c.x = round(p.gridX() * col);
            c.y = round(p.gridY() * row);
            c.w = round(Math.max(1, p.gridW()) * col);
            c.h = round(Math.max(1, p.gridH()) * row);
            maxY = Math.max(maxY, c.y + c.h);
            b.charts.add(c);
        }
        b.height = Math.max(1, maxY);
        for (GrafanaClient.Variable v : d.variables()) {
            Block.Variable bv = new Block.Variable();
            bv.name = v.name(); bv.label = v.label(); bv.defaultValue = v.defaultValue() == null ? "" : v.defaultValue();
            bv.options = new java.util.ArrayList<>(v.options());
            b.variables.add(bv);
        }
        return b;
    }

    private static double round(double v) { return Math.round(v * 10) / 10.0; }
}
