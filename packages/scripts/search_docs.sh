#!/bin/bash
# 搜索飞书文档
# 用法: ./search_docs.sh "关键词"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/feishu.sh"

keyword="$1"

if [ -z "$keyword" ]; then
    echo "用法: $0 <关键词>"
    exit 1
fi

echo "🔍 搜索: ${keyword}"
search_documents "$keyword" | jq .
