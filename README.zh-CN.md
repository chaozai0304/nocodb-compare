# nocodb-compare

用于 NocoDB 的 **Schema 对比 + 升级执行平台**。

对比“正式环境(Source)”与“待升级环境(Target)”的 Base Schema（表/字段），生成可执行升级计划（plan），支持导出 JSONL、导入执行，以及命令行执行。

**语言：** [English](README.md) · 简体中文（当前） · [Français](README.fr-FR.md)

---

## 能力概览

- Schema 对比（表/字段）
- 生成升级计划（可勾选步骤）
- Dry-run / 执行升级
- 计划导出为 **JSONL**（每行一次 API 调用参数）
- 导入 JSON/JSONL 计划并直接执行到指定 target
- 提供命令行脚本适配服务器/CI

> 说明：当前优先支持 **NocoDB Meta API v2**；v3 的 schema diff 暂未实现。

---

## 快速开始（Docker）

单端口部署（UI + API）：

- `docker build -t nocodb-compare:latest .`
- `docker run -d --name nocodb-compare -p 5175:5175 -v "$PWD/data:/data" --restart unless-stopped nocodb-compare:latest`

访问：
- http://localhost:5175/

容器内存储：
- 配置：`/data/config.json`
- 登录账号：`/data/auth.json`

---

## 开发启动

- 安装依赖：`npm i`
- 启动：`npm run dev`

- Web: http://localhost:5173
- Server: http://localhost:5175

---

## 登录与重置用户名密码

系统带简单登录（Cookie Session）。

首次启动默认账号（仅第一次写入 auth 文件时生效）：
- 用户名：`admin`
- 密码：`ChangeMe123!`

可用环境变量覆盖：
- `INIT_USERNAME`
- `INIT_PASSWORD`

登录后，右上角菜单可 **修改用户名/密码**。

---

## 使用方式（UI）

### 1）对比升级

菜单：**对比升级**

1. 填写 source/target：`baseUrl`、`apiToken`、`baseId`
2. 点击“开始对比”生成 plan
3. 勾选步骤
4. 建议先 Dry-run
5. 点击“执行升级”

### 2）导入执行

菜单：**导入执行**

1. 上传导出的 `.jsonl` 或 `.json`
2. 填写要执行的 target 信息
3. 勾选步骤 → Dry-run → 执行

执行时后端会：
- 注入真实 token（导出文件里 token 会被脱敏成 `***`）
- 解析 `{tableId}` / `{columnId}` 占位符
- 将导入文件中的 URL 重写到当前 target.baseUrl，并尽量把 `/bases/{baseId}` 替换成你填写的 target.baseId

---

## 命令行执行（服务器/CI）

脚本：`scripts/execute-plan.sh`

依赖：`curl`、`jq`

示例：

- Dry-run（默认）：
  - `./scripts/execute-plan.sh -a https://nocodb.example.com -t '<token>' -b '<baseId>' -f ./plan.jsonl`

- 真正执行：
  - `./scripts/execute-plan.sh -a https://nocodb.example.com -t '<token>' -b '<baseId>' -f ./plan.jsonl --apply`

- 包含危险步骤：
  - `./scripts/execute-plan.sh ... --apply --all`

- 平台不在本机：
  - `./scripts/execute-plan.sh -p http://your-host:5175 -a ... -t ... -b ... -f ... --apply`

---

## 配置存储（重要）

为了避免把 token/密码等敏感信息推送到 GitHub：

- 默认存储到用户目录：
  - `~/.nocodb-compare/config.json`
  - `~/.nocodb-compare/auth.json`

也可用环境变量指定：
- `CONFIG_FILE=/data/config.json`
- `AUTH_FILE=/data/auth.json`

仓库已忽略：`data/` 与 `apps/**/data/`。

---

## 字体（开源）

Web 端打包内置开源字体（通过 `@fontsource/*` 引入）：

- Inter — SIL Open Font License 1.1
- Noto Sans SC — SIL Open Font License 1.1

---

## License

MIT，见 [LICENSE](LICENSE)。
