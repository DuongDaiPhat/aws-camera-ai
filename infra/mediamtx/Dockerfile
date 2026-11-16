FROM alpine:3.22 AS certificates
RUN apk add --no-cache ca-certificates

# The upstream scratch image has no CA bundle for HTTPS auth callbacks.
FROM bluenviron/mediamtx:1.21.0
COPY --from=certificates /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
