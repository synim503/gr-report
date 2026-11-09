package com.example.reporter.store;

import com.example.reporter.model.Template;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Stream;

@Component
public class TemplateStore {
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private final Path dir;
    private final ObjectMapper mapper;

    public TemplateStore(@Value("${app.data-dir}") String dataDir, ObjectMapper mapper) throws IOException {
        this.dir = Path.of(dataDir, "templates");
        Files.createDirectories(dir);
        this.mapper = mapper;
    }

    public record Summary(String id, String name, String updatedAt) {}

    public List<Summary> list() {
        try (Stream<Path> s = Files.list(dir)) {
            List<Summary> out = new ArrayList<>();
            for (Path p : (Iterable<Path>) s.filter(f -> f.toString().endsWith(".json"))::iterator) {
                try {
                    Template t = mapper.readValue(p.toFile(), Template.class);
                    out.add(new Summary(t.id, t.name, t.updatedAt));
                } catch (IOException ignored) { /* skip corrupt */ }
            }
            out.sort(Comparator.comparing((Summary x) -> x.updatedAt() == null ? "" : x.updatedAt()).reversed());
            return out;
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }

    public Optional<Template> get(String id) {
        Path p = path(id);
        if (!Files.exists(p)) return Optional.empty();
        try { return Optional.of(mapper.readValue(p.toFile(), Template.class)); }
        catch (IOException e) { throw new UncheckedIOException(e); }
    }

    /** Creates when id is null/unknown-new, otherwise overwrites. */
    public synchronized Template save(String id, Template t) {
        t.id = id != null ? id : UUID.randomUUID().toString();
        t.updatedAt = Instant.now().toString();
        try {
            Path tmp = Files.createTempFile(dir, "tpl", ".tmp");
            mapper.writeValue(tmp.toFile(), t);
            Files.move(tmp, path(t.id), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) { throw new UncheckedIOException(e); }
        return t;
    }

    public boolean delete(String id) {
        try { return Files.deleteIfExists(path(id)); }
        catch (IOException e) { throw new UncheckedIOException(e); }
    }

    private Path path(String id) {
        if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("invalid template id");
        return dir.resolve(id + ".json");
    }
}
