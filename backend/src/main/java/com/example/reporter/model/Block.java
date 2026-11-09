package com.example.reporter.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.ArrayList;
import java.util.List;

/**
 * Reusable block: a fixed set of charts from one dashboard with a predefined layout.
 * Variables (e.g. host, instance) are sent to Grafana as var-NAME for every chart when the block is placed.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Block {
    public String id;
    @NotBlank @Size(max = 200) public String name = "Block";
    @NotBlank @Pattern(regexp = "^[A-Za-z0-9_\\-]{1,64}$") public String dashboardUid;
    @Size(max = 200) public String dashboardTitle;
    /** Bounding size of the layout in points. */
    @DecimalMin("1") @DecimalMax("5000") public double width = 515;
    @DecimalMin("1") @DecimalMax("5000") public double height = 300;
    @Size(max = 50) @Valid public List<Variable> variables = new ArrayList<>();
    @NotEmpty @Size(max = 50) @Valid public List<BlockChart> charts = new ArrayList<>();
    public String updatedAt;

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Variable {
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9_\\-.]{1,64}$", message = "invalid variable name") public String name;
        @Size(max = 200) public String label;
        @Size(max = 500) public String defaultValue = "";
    }

    /** Chart position relative to the block's top-left corner (points). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BlockChart {
        @Min(0) public int panelId;
        @Size(max = 200) public String title;
        @DecimalMin("0") @DecimalMax("5000") public double x;
        @DecimalMin("0") @DecimalMax("10000") public double y;
        @DecimalMin("1") @DecimalMax("5000") public double w = 200;
        @DecimalMin("1") @DecimalMax("5000") public double h = 120;
    }
}
