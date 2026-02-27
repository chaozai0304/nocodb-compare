#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：
  execute-plan.sh -a <nocodbBaseUrl> -t <apiToken> -b <baseId> -f <planFile> [options]

必填参数：
  -a  NocoDB Base URL，例如 https://nocodb.company.com
  -t  API Token（v2/v3 均可；平台会自动注入到请求头）
  -b  Base ID
  -f  计划文件路径：支持 .jsonl（导出的 JSONL）或 .json（Plan/steps）

可选参数：
  -p  升级平台地址（nocodb-compare server），默认 http://localhost:5175
  -U  平台登录用户名（默认 admin；也可用环境变量 NCC_PLATFORM_USERNAME）
  -P  平台登录密码（默认 ChangeMe123!；也可用环境变量 NCC_PLATFORM_PASSWORD）
  --no-login   不自动登录平台（仅当你能确保 curl 已携带有效 cookie 时才建议使用）
  -v  API 版本：v2 或 v3，默认 v2
  --dry-run      只校验不执行（默认）
  --apply        真正执行
  --safe-only    仅执行非 danger 步骤（默认）
  --all          执行全部步骤（包含 danger）

依赖：curl、jq

示例：
  ./scripts/execute-plan.sh -a https://nocodb-staging.company.com -t 'xxx' -b pRdVnZXPZgA -f ./plan.jsonl --apply
EOF
}

PLATFORM_URL="http://localhost:5175"
API_VERSION="v2"
MODE="dry-run"          # dry-run | apply
SELECTION="safe-only"   # safe-only | all

PLATFORM_USERNAME="${NCC_PLATFORM_USERNAME:-admin}"
PLATFORM_PASSWORD="${NCC_PLATFORM_PASSWORD:-ChangeMe123!}"
AUTO_LOGIN=true

NOCO_URL=""
TOKEN=""
BASE_ID=""
PLAN_FILE=""

# --- parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -a)
      NOCO_URL="$2"; shift 2 ;;
    -t)
      TOKEN="$2"; shift 2 ;;
    -b)
      BASE_ID="$2"; shift 2 ;;
    -f)
      PLAN_FILE="$2"; shift 2 ;;
    -p)
      PLATFORM_URL="$2"; shift 2 ;;
    -U)
      PLATFORM_USERNAME="$2"; shift 2 ;;
    -P)
      PLATFORM_PASSWORD="$2"; shift 2 ;;
    --no-login)
      AUTO_LOGIN=false; shift 1 ;;
    -v)
      API_VERSION="$2"; shift 2 ;;
    --dry-run)
      MODE="dry-run"; shift 1 ;;
    --apply)
      MODE="apply"; shift 1 ;;
    --safe-only)
      SELECTION="safe-only"; shift 1 ;;
    --all)
      SELECTION="all"; shift 1 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "未知参数：$1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$NOCO_URL" || -z "$TOKEN" || -z "$BASE_ID" || -z "$PLAN_FILE" ]]; then
  echo "缺少必填参数" >&2
  usage
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "缺少依赖：jq" >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "缺少依赖：curl" >&2
  exit 2
fi

if [[ ! -f "$PLAN_FILE" ]]; then
  echo "文件不存在：$PLAN_FILE" >&2
  exit 2
fi

normalize_url() {
  local u="$1"
  # 去掉末尾 /
  u="${u%/}"
  echo "$u"
}

PLATFORM_URL="$(normalize_url "$PLATFORM_URL")"
NOCO_URL="$(normalize_url "$NOCO_URL")"

COOKIE_JAR="$(mktemp -t nocodb-compare-cookie.XXXXXX.txt)"
trap 'rm -f "$COOKIE_JAR"' EXIT

platform_login() {
  local u="$1"
  local p="$2"

  # 先探测一下是否已登录（避免重复登录导致噪音）
  if curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" "$PLATFORM_URL/api/auth/me" | jq -e '.ok == true' >/dev/null 2>&1; then
    return 0
  fi

  local payload
  payload="$(jq -cn --arg username "$u" --arg password "$p" '{username:$username,password:$password}')"

  local resp_file
  resp_file="$(mktemp -t nocodb-compare-login.XXXXXX.json)"
  local http
  http=$(curl -sS -o "$resp_file" -w "%{http_code}" \
    -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -H 'content-type: application/json' \
    -X POST "$PLATFORM_URL/api/auth/login" \
    --data-binary "$payload" \
  )

  if [[ "$http" -ge 200 && "$http" -lt 300 ]]; then
    rm -f "$resp_file"
    return 0
  fi

  echo "[execute-plan] platform login failed (http=$http)" >&2
  cat "$resp_file" >&2
  rm -f "$resp_file"
  echo "[execute-plan] 说明：平台 /api/apply 需要登录 Cookie。你可以：" >&2
  echo "  1) 先在浏览器登录平台一次；或" >&2
  echo "  2) 在脚本里用 -U/-P 或环境变量 NCC_PLATFORM_USERNAME/NCC_PLATFORM_PASSWORD 提供平台账号密码。" >&2
  return 1
}

build_plan_json() {
  # 输出一个 Plan JSON：{ createdAt, steps:[...] }
  # 支持：
  # - JSONL：每行一个 step
  # - JSON：Plan 对象 / {plan:{steps}} / steps 数组

  local file="$1"

  # jq 对 JSONL（多个 JSON text）执行 `jq . file` 也会返回 0，
  # 这会导致 JSONL 被误判为 JSON，从而报 “不包含 steps/plan.steps”。
  # 因此这里优先判断 JSONL。

  # 1) 按扩展名优先判断
  if [[ "$file" == *.jsonl ]]; then
    jq -cs '{ createdAt: (now | todateiso8601), steps: . }' "$file"
    return 0
  fi

  # 2) 兼容：如果文件是“多个 JSON text”的流（JSONL 形式），也按 JSONL 处理
  if jq -se 'length > 1' "$file" >/dev/null 2>&1; then
    jq -cs '{ createdAt: (now | todateiso8601), steps: . }' "$file"
    return 0
  fi

  # 先尝试当 JSON 解析
  if jq -e . "$file" >/dev/null 2>&1; then
    jq -c '
      def asPlan:
        if type == "object" and (.steps | type == "array") then
          .
        elif type == "object" and (.plan? | type == "object") and (.plan.steps? | type == "array") then
          .plan
        elif type == "array" then
          { createdAt: (now | todateiso8601), steps: . }
        else
          error("JSON 文件不包含 steps/plan.steps")
        end;

      asPlan
      | .createdAt = (.createdAt // (now | todateiso8601))
      | .steps = (.steps // [])
    ' "$file"
    return 0
  fi

  # 当 JSONL 解析（兜底）
  jq -cs '{ createdAt: (now | todateiso8601), steps: . }' "$file"
}

PLAN_JSON="$(build_plan_json "$PLAN_FILE")"

# 生成 selectedStepIds
if [[ "$SELECTION" == "all" ]]; then
  SELECTED_IDS_JSON="$(echo "$PLAN_JSON" | jq -c '[.steps[].id]')"
else
  SELECTED_IDS_JSON="$(echo "$PLAN_JSON" | jq -c '[.steps[] | select((.danger // false) | not) | .id]')"
fi

DRY_RUN=true
if [[ "$MODE" == "apply" ]]; then
  DRY_RUN=false
fi

PAYLOAD="$(jq -cn \
  --arg baseUrl "$NOCO_URL" \
  --arg apiToken "$TOKEN" \
  --arg apiVersion "$API_VERSION" \
  --arg baseId "$BASE_ID" \
  --argjson plan "$PLAN_JSON" \
  --argjson selectedStepIds "$SELECTED_IDS_JSON" \
  --argjson dryRun "$DRY_RUN" \
  '{
    target: {
      baseUrl: $baseUrl,
      apiToken: $apiToken,
      apiVersion: $apiVersion,
      baseId: $baseId
    },
    plan: $plan,
    selectedStepIds: $selectedStepIds,
    dryRun: $dryRun
  }'
)"

echo "[execute-plan] platform: $PLATFORM_URL"
echo "[execute-plan] target:   $NOCO_URL (baseId=$BASE_ID, apiVersion=$API_VERSION)"
echo "[execute-plan] file:     $PLAN_FILE"
echo "[execute-plan] mode:     $MODE"
echo "[execute-plan] select:   $SELECTION"

if [[ "$AUTO_LOGIN" == true ]]; then
  platform_login "$PLATFORM_USERNAME" "$PLATFORM_PASSWORD"
fi

RESP_FILE="$(mktemp -t nocodb-compare-apply.XXXXXX.json)"
HTTP_CODE=$(curl -sS -o "$RESP_FILE" -w "%{http_code}" \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -X POST "$PLATFORM_URL/api/apply" \
  --data-binary "$PAYLOAD" \
)

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  cat "$RESP_FILE" | jq .
  echo "[execute-plan] done (http=$HTTP_CODE)"
  exit 0
fi

echo "[execute-plan] failed (http=$HTTP_CODE)" >&2
cat "$RESP_FILE" >&2
exit 1
