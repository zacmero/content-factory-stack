FROM ghcr.io/gitroomhq/postiz-app:latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*
