package com.example.reporter.grafana;

public class GrafanaException extends RuntimeException {
    private final int status;
    public GrafanaException(int status, String message) { super(message); this.status = status; }
    public GrafanaException(int status, String message, Throwable cause) { super(message, cause); this.status = status; }
    /** HTTP status returned by Grafana, or 0 when Grafana could not be reached at all. */
    public int status() { return status; }
}
