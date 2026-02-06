# --- build stage ---
FROM node:24-alpine AS builder
WORKDIR /app

# 仅拷贝依赖声明，利用缓存
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

# 拷贝源码并构建
COPY . .
RUN npm run build


# --- runtime stage ---
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5175
ENV SERVE_WEB=1
ENV CONFIG_FILE=/data/config.json

# 安装 server 运行依赖（workspaces 方式会把依赖装到根 node_modules）
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
RUN npm ci --omit=dev -w apps/server

# 拷贝构建产物
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# 默认把配置落到 /data（可挂载卷）
VOLUME ["/data"]
EXPOSE 5175

CMD ["npm", "-w", "apps/server", "run", "start"]
