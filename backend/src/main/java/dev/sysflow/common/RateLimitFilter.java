package dev.sysflow.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Simple fixed-window per-IP rate limit for the AI advisory, SRS-import, and
 * real-pricing endpoints — all unauthenticated per SecurityConfig, and all
 * proxy to an external API (paid for AI/SRS, free-but-still-abusable for
 * pricing) with no other abuse control in front of them.
 *
 * In-memory and single-instance only; if this service is ever run behind
 * multiple replicas, replace with a shared store (e.g. Redis).
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Set<String> LIMITED_PATHS = Set.of(
            "/api/ai/analyze", "/api/srs/import", "/api/pricing/estimate", "/api/pricing/compare", "/api/interview/grade");
    private static final int MAX_REQUESTS_PER_WINDOW = 20;
    private static final long WINDOW_MILLIS = 60_000;

    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    private record Window(AtomicLong windowStart, AtomicLong count) {}

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (!LIMITED_PATHS.contains(request.getRequestURI())) {
            filterChain.doFilter(request, response);
            return;
        }

        String key = clientIp(request) + ":" + request.getRequestURI();
        long now = System.currentTimeMillis();
        Window window = windows.computeIfAbsent(key, k -> new Window(new AtomicLong(now), new AtomicLong(0)));

        long remaining;
        long resetInSeconds;
        boolean limited;

        synchronized (window) {
            if (now - window.windowStart().get() > WINDOW_MILLIS) {
                window.windowStart().set(now);
                window.count().set(0);
            }
            long count = window.count().incrementAndGet();
            limited = count > MAX_REQUESTS_PER_WINDOW;
            remaining = Math.max(0, MAX_REQUESTS_PER_WINDOW - count);
            resetInSeconds = Math.max(0, (window.windowStart().get() + WINDOW_MILLIS - now) / 1000);
        }

        response.setHeader("X-RateLimit-Limit", String.valueOf(MAX_REQUESTS_PER_WINDOW));
        response.setHeader("X-RateLimit-Remaining", String.valueOf(remaining));
        response.setHeader("X-RateLimit-Reset", String.valueOf(resetInSeconds));

        if (limited) {
            response.setHeader("Retry-After", String.valueOf(resetInSeconds));
            response.setStatus(429); // 429 Too Many Requests — not defined as a constant on HttpServletResponse
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Too many analysis requests — please wait a moment and try again.\"}");
            return;
        }

        filterChain.doFilter(request, response);
    }

    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
