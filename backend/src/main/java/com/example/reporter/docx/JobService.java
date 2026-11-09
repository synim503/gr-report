package com.example.reporter.docx;

import com.example.reporter.model.Template;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Service;

/** Asynchronous report builds that can be listed, downloaded and cancelled. */
@Service
public class JobService {
    public enum State { RUNNING, DONE, FAILED, CANCELLED }

    public record JobView(String id, String name, State state, int done, int total, long startedAt, Long finishedAt,
                          String error, List<String> warnings, Integer sizeBytes) {}

    private static final int KEEP_FINISHED = 30;
    private static final long KEEP_MS = 60 * 60 * 1000L;

    private static final class Job implements ReportService.Progress {
        final String id = UUID.randomUUID().toString(), name;
        final long startedAt = System.currentTimeMillis();
        volatile State state = State.RUNNING;
        volatile int total;
        final AtomicInteger done = new AtomicInteger();
        volatile Long finishedAt;
        volatile String error;
        volatile List<String> warnings = List.of();
        volatile byte[] file;
        volatile Future<?> future;
        volatile boolean cancelled;
        Job(String name) { this.name = name; }
        public boolean cancelled() { return cancelled; }
        public void total(int c) { total = c; }
        public void step() { done.incrementAndGet(); }
        JobView view() {
            return new JobView(id, name, state, done.get(), total, startedAt, finishedAt, error, warnings, file == null ? null : file.length);
        }
    }

    private final ReportService reports;
    private final Map<String, Job> jobs = Collections.synchronizedMap(new LinkedHashMap<>());
    private final ExecutorService runner = Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "report-job"); t.setDaemon(true); return t; });

    public JobService(ReportService reports) { this.reports = reports; }

    public JobView submit(Template t, boolean strict, Map<String, String> overrides) {
        evict();
        Job job = new Job(t.name);
        jobs.put(job.id, job);
        job.future = runner.submit(() -> {
            try {
                ReportService.Result r = reports.generate(t, strict, overrides, job);
                if (job.cancelled) { finish(job, State.CANCELLED, null); return; }
                job.warnings = r.warnings();
                job.file = r.docx();
                finish(job, State.DONE, null);
            } catch (CancellationException e) {
                finish(job, State.CANCELLED, null);
            } catch (Throwable e) {
                finish(job, job.cancelled ? State.CANCELLED : State.FAILED, job.cancelled ? null : String.valueOf(e.getMessage() != null ? e.getMessage() : e));
            }
        });
        return job.view();
    }

    private void finish(Job job, State s, String error) {
        job.error = error;
        job.finishedAt = System.currentTimeMillis();
        job.state = s;
    }

    public List<JobView> list() {
        List<JobView> out = new ArrayList<>();
        synchronized (jobs) { for (Job j : jobs.values()) out.add(j.view()); }
        Collections.reverse(out);
        return out;
    }

    public Optional<JobView> get(String id) { return Optional.ofNullable(jobs.get(id)).map(Job::view); }

    public Optional<byte[]> file(String id) { Job j = jobs.get(id); return j == null ? Optional.empty() : Optional.ofNullable(j.file); }

    /** Running job: cancelled (in-flight Grafana requests are interrupted). Finished job: removed from the list. */
    public boolean cancelOrRemove(String id) {
        Job j = jobs.get(id);
        if (j == null) return false;
        if (j.state == State.RUNNING) {
            j.cancelled = true;
            Future<?> f = j.future;
            if (f != null) f.cancel(true);
            finish(j, State.CANCELLED, null);
        } else jobs.remove(id);
        return true;
    }

    private void evict() {
        long now = System.currentTimeMillis();
        synchronized (jobs) {
            jobs.values().removeIf(j -> j.finishedAt != null && now - j.finishedAt > KEEP_MS);
            List<Job> finished = jobs.values().stream().filter(j -> j.finishedAt != null).toList();
            for (int i = 0; i < finished.size() - KEEP_FINISHED + 1; i++) jobs.remove(finished.get(i).id);
        }
    }
}
