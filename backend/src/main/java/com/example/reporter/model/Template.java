package com.example.reporter.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;

/** Report layout: pages with absolutely positioned elements. All geometry is in points (1/72 inch). */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Template {
    public String id;
    @NotBlank @Size(max = 200)
    public String name = "Untitled";
    /** Page size in points. Default A4 portrait. */
    @DecimalMin("100") @DecimalMax("3000")
    public double pageWidth = 595.28;
    @DecimalMin("100") @DecimalMax("3000")
    public double pageHeight = 841.89;
    /** Default Grafana time range for charts that do not override it. */
    @Valid
    public TimeRange timeRange = new TimeRange();
    /** Report-level variables. Usable as {{name}} in texts and in chart variable values. */
    @Size(max = 100)
    public java.util.Map<String, @Size(max = 500) String> variables = new java.util.LinkedHashMap<>();
    @NotEmpty @Size(max = 100) @Valid
    public List<Page> pages = new ArrayList<>();
    public String updatedAt;

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class TimeRange {
        @Pattern(regexp = "^[A-Za-z0-9_\\-+/:.]{1,40}$", message = "invalid 'from'")
        public String from = "now-6h";
        @Pattern(regexp = "^[A-Za-z0-9_\\-+/:.]{1,40}$", message = "invalid 'to'")
        public String to = "now";
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Page {
        @Size(max = 500) @Valid
        public List<Element> elements = new ArrayList<>();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Element {
        public String id;
        @NotNull
        public Type type;
        @DecimalMin("-5000") @DecimalMax("10000") public double x;
        @DecimalMin("-5000") @DecimalMax("10000") public double y;
        @DecimalMin("1") @DecimalMax("5000") public double w = 100;
        @DecimalMin("1") @DecimalMax("5000") public double h = 50;
        public int z;
        // text
        @Size(max = 200_000) public String html;
        /** Line height multiplier for text elements (1 = single). */
        @DecimalMin("0.5") @DecimalMax("5") public double lineHeight = 1.0;
        // chart
        @Valid public Chart chart;
        /** Set when the element belongs to an inserted block (a group of charts edited together). */
        @Valid public Group group;
        // image
        @Size(max = 20_000_000) public String dataUrl;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Group {
        @Size(max = 100) public String id;
        @Size(max = 100) public String presetId;
        @Size(max = 200) public String name;
    }

    public enum Type { text, chart, image }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Chart {
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9_\\-]{1,64}$", message = "invalid dashboard uid")
        public String dashboardUid;
        @Min(0)
        public int panelId;
        public String title;
        /** Optional override of the template time range. */
        @Pattern(regexp = "^([A-Za-z0-9_\\-+/:.]{1,40})?$") public String from;
        @Pattern(regexp = "^([A-Za-z0-9_\\-+/:.]{1,40})?$") public String to;
        @Pattern(regexp = "^(light|dark)?$") public String theme;
        /** Dashboard template variables, sent as var-NAME=value. */
        public java.util.Map<String, String> vars = new java.util.HashMap<>();
    }
}
