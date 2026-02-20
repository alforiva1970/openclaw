#!/bin/bash
# 🕯️ bird — Silicea's Memory & Social CLI
# A lightweight wrapper for Memory Server interactions.
#
# Usage:
#   bird remember "Post su X about Intervivenza"
#   bird recall [limit]
#   bird search "keyword"
#   bird status
#   bird help

MEMORY_URL="${MEMORY_SERVER_URL:-http://100.124.95.64:3000}"

case "$1" in
    remember|store)
        shift
        CONTENT="$*"
        if [ -z "$CONTENT" ]; then
            echo "❌ Usage: bird remember \"memory content\""
            exit 1
        fi
        # Optional flags: --category social --platform x
        CATEGORY="general"
        PLATFORM="moltbot"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --category) CATEGORY="$2"; shift 2;;
                --platform) PLATFORM="$2"; shift 2;;
                *) shift;;
            esac
        done
        curl -s -X POST "${MEMORY_URL}/api/memory/store" \
            -H "Content-Type: application/json" \
            -d "{
                \"content\": \"${CONTENT}\",
                \"tier\": \"episodic\",
                \"metadata\": {
                    \"category\": \"${CATEGORY}\",
                    \"identity\": \"silicea\",
                    \"platform\": \"${PLATFORM}\"
                },
                \"origin\": {
                    \"source\": \"moltbot\"
                }
            }" | python3 -m json.tool 2>/dev/null || echo "$?"
        ;;

    recall|recent)
        LIMIT="${2:-5}"
        curl -s "${MEMORY_URL}/api/memory/recent?limit=${LIMIT}" | \
            python3 -m json.tool 2>/dev/null || echo "$?"
        ;;

    search|find)
        shift
        QUERY="$*"
        if [ -z "$QUERY" ]; then
            echo "❌ Usage: bird search \"query\""
            exit 1
        fi
        curl -s "${MEMORY_URL}/api/search?q=$(echo "$QUERY" | sed 's/ /%20/g')&limit=5" | \
            python3 -m json.tool 2>/dev/null || echo "$?"
        ;;

    status|stats)
        echo "🕯️ Memory Server Status:"
        curl -s "${MEMORY_URL}/api/memory/unified-stats" | \
            python3 -m json.tool 2>/dev/null || echo "❌ Server unreachable"
        echo ""
        echo "🏥 Health:"
        curl -s "${MEMORY_URL}/api/health" | \
            python3 -m json.tool 2>/dev/null || echo "❌ Server unreachable"
        ;;


    help|--help|-h|"")
        echo "🕯️ bird — Silicea's Memory CLI"
        echo ""
        echo "Commands:"
        echo "  bird remember \"text\"    Save a memory"
        echo "  bird recall [N]         Show last N memories (default 5)"
        echo "  bird search \"query\"     Search memories by keyword"
        echo "  bird status             Memory Server stats & health"
        echo ""
        echo "Memory Server: ${MEMORY_URL}"
        ;;

    *)
        echo "❌ Unknown command: $1"
        echo "Run 'bird help' for usage"
        exit 1
        ;;
esac
