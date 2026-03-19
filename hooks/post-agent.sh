#!/bin/bash
# SubagentStop 后自动提醒 Claude 更新 progress-log
# 通过向 stderr 输出提示信息（Claude 会看到 hook 输出）
echo "REMINDER: If this was an auto-dev subagent, call auto_dev_checkpoint() now." >&2
