package com.example.reporter.store;

import com.example.reporter.model.Settings;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;

/** File-backed settings. Defaults come from GRAFANA_URL / GRAFANA_TOKEN env (app.grafana.*). */
@Component
public class SettingsStore {
    private final Path file;
    private final ObjectMapper mapper;
    private volatile Settings current;

    public SettingsStore(@Value("${app.data-dir}") String dir, ObjectMapper mapper,
                         @Value("${app.grafana.url:}") String envUrl,
                         @Value("${app.grafana.token:}") String envToken) throws IOException {
        Path d = Path.of(dir);
        Files.createDirectories(d);
        this.file = d.resolve("settings.json");
        this.mapper = mapper;
        Settings s = Files.exists(file) ? mapper.readValue(file.toFile(), Settings.class) : new Settings();
        if (s.grafanaUrl == null || s.grafanaUrl.isBlank()) s.grafanaUrl = envUrl;
        if (s.token == null || s.token.isBlank()) s.token = envToken;
        this.current = s;
    }

    public Settings get() { return current; }

    public synchronized Settings update(String url, String token, Integer orgId, Double imageScale, Integer parallelism) {
        Settings s = new Settings();
        s.grafanaUrl = url != null ? normalize(url) : current.grafanaUrl;
        s.token = token != null ? token : current.token;   // null = keep, "" = clear
        s.orgId = orgId != null ? orgId : current.orgId;
        s.imageScale = imageScale != null ? imageScale : current.imageScale;
        s.parallelism = parallelism != null ? parallelism : current.parallelism;
        try {
            Path tmp = Files.createTempFile(file.getParent(), "settings", ".tmp");
            try { Files.setPosixFilePermissions(tmp, PosixFilePermissions.fromString("rw-------")); } catch (UnsupportedOperationException ignored) {}
            mapper.writeValue(tmp.toFile(), s);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) { throw new UncheckedIOException(e); }
        current = s;
        return s;
    }

    public static String normalize(String url) {
        String u = url.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }
}
