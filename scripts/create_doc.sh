#!/bin/bash
# 创建飞书文档
# 用法: ./create_doc.sh "文档标题" ["初始内容"]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/feishu.sh"

title="${1:-未命名文档}"
content="${2:-}"

echo "📄 创建文档: ${title}"
result=$(create_document "$title")
echo "$result" | jq .

doc_id=$(echo "$result" | jq -r '.data.document.document_id')

if [ -n "$content" ] && [ "$doc_id" != "null" ]; then
    echo -e "\n📝 插入内容..."
    insert_text "$doc_id" "$content" | jq .
fi

if [ "$doc_id" != "null" ]; then
    echo -e "\n✅ 文档链接: https://feishu.cn/docx/${doc_id}"
fi
