# ChatHub 后端 Dockerfile
# 用 Node 官方 slim 镜像，轻量、可在任何支持 Docker 的主机上跑
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="chathub-backend"
LABEL org.opencontainers.image.description="ChatHub: Node.js + SQLite + WebSocket chat backend"

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/chat.db

# 工作目录
WORKDIR /app

# 先装依赖，利于缓存
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# 复制后端代码（不包含 data/ ，数据目录用卷挂载）
COPY backend/server.js backend/db.js ./

# 静态文件目录：web/ 和宣传页 index.html（可选，也可以只用 OSS 托管前端）
# 如果把前端放 OSS，就不需要复制这两个目录；这里加上兼容「后端也托管前端」模式
COPY web ./web
COPY index.html ./index-landing.html

EXPOSE 8787

# 确保数据挂载目录存在
RUN mkdir -p /app/data/uploads

CMD ["node", "server.js"]
