FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# Mount a volume at /data so runs, transcripts and caches survive redeploys.
ENV HOST=0.0.0.0 LAB_DATA_DIR=/data NODE_ENV=production
EXPOSE 5190
CMD ["node", "server.mjs"]
