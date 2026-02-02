FROM alpine:latest as builder
RUN apk add --no-cache ffmpeg python3 py3-pip yt-dlp

FROM n8nio/n8n:latest

USER root

# Copy ffmpeg and dependencies from the builder
COPY --from=builder /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=builder /usr/bin/ffprobe /usr/bin/ffprobe
COPY --from=builder /usr/lib /usr/lib
COPY --from=builder /lib /lib

# Python and yt-dlp are trickier to copy due to dependencies.
# For now, let's focus on getting n8n UP with ffmpeg.
# We will skip yt-dlp for this specific build step to ensure n8n works first.
# If we need yt-dlp, we can use the http-request node to call an external service 
# or try a static binary.

USER node