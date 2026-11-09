package com.example.reporter.web;

import com.example.reporter.grafana.GrafanaException;
import org.springframework.http.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.stream.Collectors;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(GrafanaException.class)
    ResponseEntity<Map<String, Object>> grafana(GrafanaException e) {
        // Grafana auth problems are surfaced as 502 so the UI does not confuse them with its own auth.
        HttpStatus s = e.status() == 404 ? HttpStatus.NOT_FOUND
                : e.getMessage() != null && e.getMessage().contains("not configured") ? HttpStatus.PRECONDITION_FAILED
                : HttpStatus.BAD_GATEWAY;
        return ResponseEntity.status(s).body(Map.of("error", "grafana", "message", e.getMessage(), "grafanaStatus", e.status()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> invalid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage()).collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(Map.of("error", "validation", "message", msg));
    }

    @ExceptionHandler({IllegalArgumentException.class, org.springframework.http.converter.HttpMessageNotReadableException.class})
    ResponseEntity<Map<String, Object>> bad(Exception e) {
        return ResponseEntity.badRequest().body(Map.of("error", "bad_request", "message", String.valueOf(e.getMessage())));
    }
}
