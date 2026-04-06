#!/bin/bash
export PATH="/c/Program Files/nodejs:$PATH"
cd /d/Project/FightCraft
echo "=== Starting Agent: @security-reviewer ==="
"/c/Program Files/nodejs/npx.cmd" @anthropic-ai/claude-code -p "You are @security-reviewer. Use the Read tool to read firestore.rules. Briefly list the security issues."
echo ""
echo "=== Agent finished ==="
read -p "Press Enter to close pane..."
