#!/bin/bash
TMUX_BIN="/c/msys64/usr/bin/tmux"

# Create first pane for architect and send the claude command
$TMUX_BIN split-window -h
$TMUX_BIN send-keys "claude -p 'Ти @system-architect. Обовʼязково використай інструменти (наприклад Read) щоб прочитати файл app.js та зробити короткий аналіз.'" Enter

# Create second pane for security and send the claude command
$TMUX_BIN split-window -v
$TMUX_BIN send-keys "claude -p 'Ти @security-reviewer. Обовʼязково використай інструменти (наприклад Read) щоб прочитати файл firestore.rules та вказати на вразливості.'" Enter

# Balance
$TMUX_BIN select-layout tiled
