#!/bin/bash
export PATH="/c/Program Files/nodejs:$PATH"
cd /d/Project/FightCraft
echo "=== Starting Agent: @system-architect ==="
"/c/Program Files/nodejs/npx.cmd" @anthropic-ai/claude-code -p "You are @system-architect. Use the Read tool to read www/js/app.js. Briefly explain its architecture."
echo ""
echo "=== Agent finished ==="
read -p "Press Enter to close pane..."
