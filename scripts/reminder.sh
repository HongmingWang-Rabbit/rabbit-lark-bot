#!/bin/bash
# 催办任务管理脚本

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../config.sh"
source "${SCRIPT_DIR}/../lib/feishu.sh"

APP_TOKEN="${REMINDER_APP_TOKEN}"
TABLE_ID="${REMINDER_TABLE_ID}"

# 添加催办任务
add_reminder() {
    local task_name="$1"
    local target="$2"
    local deadline="$3"
    local note="${4:-}"
    
    local token=$(get_token)
    local now_ms=$(($(date +%s) * 1000))
    
    if [ -z "$deadline" ]; then
        local deadline_ms=$((($(date +%s) + 86400 * 3) * 1000))
    else
        local deadline_ms=$(($(date -d "$deadline" +%s) * 1000))
    fi
    
    curl -s -X POST "https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        -d "{
            \"fields\": {
                \"任务名称\": \"${task_name}\",
                \"催办对象\": \"${target}\",
                \"截止时间\": ${deadline_ms},
                \"状态\": \"待办\",
                \"备注\": \"${note}\",
                \"创建时间\": ${now_ms}
            }
        }"
}

# 获取所有待办任务
get_pending_reminders() {
    local token=$(get_token)
    
    curl -s -X POST "https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/search" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        -d '{
            "filter": {
                "conjunction": "and",
                "conditions": [
                    {
                        "field_name": "状态",
                        "operator": "is",
                        "value": ["待办"]
                    }
                ]
            }
        }'
}

# 标记任务完成
complete_reminder() {
    local record_id="$1"
    local proof="${2:-}"
    local token=$(get_token)
    
    local fields='"状态": "已完成"'
    if [ -n "$proof" ]; then
        fields="${fields}, \"证明材料\": \"${proof}\""
    fi
    
    curl -s -X PUT "https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${record_id}" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        -d "{\"fields\": {${fields}}}"
}

# 删除记录
delete_reminder() {
    local record_id="$1"
    local token=$(get_token)
    
    curl -s -X DELETE "https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${record_id}" \
        -H "Authorization: Bearer ${token}"
}

# 列出所有任务
list_reminders() {
    local token=$(get_token)
    
    curl -s "https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records" \
        -H "Authorization: Bearer ${token}"
}

# 提取文本值（处理飞书的复杂返回格式）
extract_text() {
    local value="$1"
    # 如果是数组格式 [{"text":"xxx","type":"text"}]，提取 text
    # 如果是普通字符串，直接返回
    echo "$value" | jq -r 'if type == "array" then .[0].text // "" elif type == "string" then . else "" end' 2>/dev/null || echo "$value"
}

# 命令行接口
case "$1" in
    add)
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "用法: $0 add <任务名称> <催办对象> [截止时间] [备注]"
            exit 1
        fi
        result=$(add_reminder "$2" "$3" "$4" "$5")
        record_id=$(echo "$result" | jq -r '.data.record.record_id')
        if [ "$record_id" != "null" ] && [ -n "$record_id" ]; then
            echo "✅ 催办任务已添加"
            echo "   任务: $2"
            echo "   对象: $3"
            echo "   ID: ${record_id}"
        else
            echo "❌ 添加失败"
            echo "$result" | jq .
        fi
        ;;
    list)
        echo "📋 所有催办任务:"
        echo "---"
        list_reminders | jq -r '.data.items[] | 
            select(.fields["任务名称"] != null) |
            "[\(.record_id)] " + 
            (if .fields["任务名称"] | type == "array" then .fields["任务名称"][0].text else .fields["任务名称"] // "?" end) +
            " → " +
            (if .fields["催办对象"] | type == "array" then .fields["催办对象"][0].text else .fields["催办对象"] // "?" end) +
            " [" +
            (if .fields["状态"] | type == "array" then .fields["状态"][0].text else .fields["状态"] // "?" end) +
            "]"'
        ;;
    pending)
        echo "⏳ 待办任务:"
        echo "---"
        get_pending_reminders | jq -r '.data.items[] |
            "[\(.record_id)] " +
            (if .fields["任务名称"] | type == "array" then .fields["任务名称"][0].text else .fields["任务名称"] // "?" end) +
            " → " +
            (if .fields["催办对象"] | type == "array" then .fields["催办对象"][0].text else .fields["催办对象"] // "?" end)'
        ;;
    complete)
        if [ -z "$2" ]; then
            echo "用法: $0 complete <record_id> [证明材料链接]"
            exit 1
        fi
        result=$(complete_reminder "$2" "$3")
        code=$(echo "$result" | jq -r '.code')
        if [ "$code" = "0" ]; then
            echo "✅ 任务已标记完成 (ID: $2)"
        else
            echo "❌ 操作失败"
            echo "$result" | jq .
        fi
        ;;
    delete)
        if [ -z "$2" ]; then
            echo "用法: $0 delete <record_id>"
            exit 1
        fi
        result=$(delete_reminder "$2")
        code=$(echo "$result" | jq -r '.code')
        if [ "$code" = "0" ]; then
            echo "✅ 已删除 (ID: $2)"
        else
            echo "❌ 删除失败"
            echo "$result" | jq .
        fi
        ;;
    *)
        echo "📌 催办任务管理"
        echo ""
        echo "用法:"
        echo "  $0 add <任务名称> <催办对象> [截止时间] [备注]"
        echo "  $0 list"
        echo "  $0 pending"
        echo "  $0 complete <record_id> [证明材料]"
        echo "  $0 delete <record_id>"
        echo ""
        echo "示例:"
        echo "  $0 add \"提交报告\" \"小明\" \"2026-03-01\" \"本周五前\""
        echo "  $0 complete recvch406nkuvJ \"http://...\""
        ;;
esac
