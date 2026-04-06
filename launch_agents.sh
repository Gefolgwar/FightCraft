#!/bin/bash
TMUX_BIN="/c/msys64/usr/bin/tmux"
CLAUDE_BIN="/c/Users/user/AppData/Roaming/npm/claude"

# Pane 1: System Architect
$TMUX_BIN split-window -h "bash -c '$CLAUDE_BIN -p \"Ти @system-architect. Зроби дуже короткий аналіз архітектури FightCraft (в межах 3 речень).\"; echo \"\"; read -p \"[Натисніть Enter для закриття]\"'"

# Pane 2: Security Reviewer
$TMUX_BIN split-window -v "bash -c '$CLAUDE_BIN -p \"Ти @security-reviewer. Зроби дуже короткий аудит безпеки FightCraft (в межах 3 речень).\"; echo \"\"; read -p \"[Натисніть Enter для закриття]\"'"

# Balance panes
$TMUX_BIN select-layout tiled
