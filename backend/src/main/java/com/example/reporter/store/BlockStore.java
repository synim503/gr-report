package com.example.reporter.store;

import com.example.reporter.model.Block;
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
public class BlockStore {
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private final Path dir;
    private final ObjectMapper mapper;

    public BlockStore(@Value("${app.data-dir}") String dataDir, ObjectMapper mapper) throws IOException {
        this.dir = Path.of(dataDir, "blocks");
        Files.createDirectories(dir);
        this.mapper = mapper;
    }

    public List<Block> list() {
        try (Stream<Path> s = Files.list(dir)) {
            List<Block> out = new ArrayList<>();
            for (Path p : (Iterable<Path>) s.filter(f -> f.toString().endsWith(".json"))::iterator) {
                try { out.add(mapper.readValue(p.toFile(), Block.class)); } catch (IOException ignored) { }
            }
            out.sort(Comparator.comparing((Block b) -> b.name.toLowerCase()));
            return out;
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }

    public Optional<Block> get(String id) {
        Path p = path(id);
        if (!Files.exists(p)) return Optional.empty();
        try { return Optional.of(mapper.readValue(p.toFile(), Block.class)); } catch (IOException e) { throw new UncheckedIOException(e); }
    }

    public synchronized Block save(String id, Block b) {
        b.id = id != null ? id : UUID.randomUUID().toString();
        b.updatedAt = Instant.now().toString();
        Set<String> seen = new HashSet<>();
        for (Block.Variable v : b.variables) if (!seen.add(v.name)) throw new IllegalArgumentException("duplicate variable " + v.name);
        try {
            Path tmp = Files.createTempFile(dir, "blk", ".tmp");
            mapper.writeValue(tmp.toFile(), b);
            Files.move(tmp, path(b.id), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) { throw new UncheckedIOException(e); }
        return b;
    }

    public boolean delete(String id) {
        try { return Files.deleteIfExists(path(id)); } catch (IOException e) { throw new UncheckedIOException(e); }
    }

    private Path path(String id) {
        if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("invalid block id");
        return dir.resolve(id + ".json");
    }
}
