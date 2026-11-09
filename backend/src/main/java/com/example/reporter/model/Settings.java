package com.example.reporter.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Persisted connection settings (token is never serialized to clients). */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Settings {
    public String grafanaUrl = "";
    public String token = "";
    public int orgId = 1;
    /** Multiplier of pixel density for rendered panel images. */
    public double imageScale = 1.5;
}
