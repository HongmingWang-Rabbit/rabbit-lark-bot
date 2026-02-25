#!/bin/bash
# 读取飞书文档内容
# 用法: ./read_doc.sh <document_id>

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/feishu.sh"

doc_id="$1"

if [ -z "$doc_id" ]; then
    echo "用法: $0 <document_id>"
    exit 1
fi

echo "📖 获取文档信息..."
get_document_info "$doc_id" | jq .

echo -e "\n📄 文档内容:"
get_document_content "$doc_id" | jq -r '.data.content // "无法获取内容"'
