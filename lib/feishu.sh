#!/bin/bash
# 飞书 API 封装库

FEISHU_APP_ID="${FEISHU_APP_ID:-cli_a915e566ba389bd8}"
FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-HfuiV26xz4tCQ6XuoEnpOeJMTOfepHYs}"
FEISHU_BASE_URL="https://open.feishu.cn/open-apis"

# 获取 tenant_access_token
get_token() {
    curl -s -X POST "${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal" \
        -H 'Content-Type: application/json' \
        -d "{
            \"app_id\": \"${FEISHU_APP_ID}\",
            \"app_secret\": \"${FEISHU_APP_SECRET}\"
        }" | jq -r '.tenant_access_token'
}

# 创建文档
# 用法: create_document "标题" ["folder_token"]
create_document() {
    local title="$1"
    local folder_token="${2:-}"
    local token=$(get_token)
    
    local body="{\"title\": \"${title}\"}"
    if [ -n "$folder_token" ]; then
        body="{\"title\": \"${title}\", \"folder_token\": \"${folder_token}\"}"
    fi
    
    curl -s -X POST "${FEISHU_BASE_URL}/docx/v1/documents" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        -d "$body"
}

# 获取文档内容（纯文本）
get_document_content() {
    local doc_id="$1"
    local token=$(get_token)
    
    curl -s "${FEISHU_BASE_URL}/docx/v1/documents/${doc_id}/raw_content" \
        -H "Authorization: Bearer ${token}"
}

# 获取文档元信息
get_document_info() {
    local doc_id="$1"
    local token=$(get_token)
    
    curl -s "${FEISHU_BASE_URL}/docx/v1/documents/${doc_id}" \
        -H "Authorization: Bearer ${token}"
}

# 获取文档所有块
get_document_blocks() {
    local doc_id="$1"
    local token=$(get_token)
    
    curl -s "${FEISHU_BASE_URL}/docx/v1/documents/${doc_id}/blocks" \
        -H "Authorization: Bearer ${token}"
}

# 搜索文档
search_documents() {
    local keyword="$1"
    local token=$(get_token)
    
    curl -s -X POST "${FEISHU_BASE_URL}/suite/docs-api/search/object" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        -d "{
            \"search_key\": \"${keyword}\",
            \"count\": 20,
            \"offset\": 0
        }"
}

# 获取群聊列表
get_chat_list() {
    local token=$(get_token)
    curl -s "${FEISHU_BASE_URL}/im/v1/chats?page_size=20" \
        -H "Authorization: Bearer ${token}"
}

# 发送消息到群聊
# 用法: send_message <chat_id> <message_text>
send_message() {
    local chat_id="$1"
    local text="$2"
    local token=$(get_token)
    
    curl -s -X POST "${FEISHU_BASE_URL}/im/v1/messages?receive_id_type=chat_id" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        -d "{
            \"receive_id\": \"${chat_id}\",
            \"msg_type\": \"text\",
            \"content\": \"{\\\"text\\\": \\\"${text}\\\"}\"
        }"
}
