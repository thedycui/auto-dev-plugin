# 邮件 MCP Server 设计文档

## 1. 背景与目标

用户（崔大洋）使用科大讯飞 Coremail 邮件系统（`mail.iflytek.com`，域名 `in.iflytek.com`，强制 SSL），希望 Claude Code 能直接收发邮件，实现周报抓取后自动发送等工作流。

**目标：** 开发一个独立的邮件 MCP Server 插件，提供 IMAP 收信和 SMTP 发信能力。

## 2. 方案对比

| 维度 | 方案 A：独立 MCP 插件 | 方案 B：嵌入 auto-dev-plugin |
|------|----------------------|---------------------------|
| 架构 | 独立仓库/目录，独立进程 | 在现有 auto-dev MCP Server 中添加工具 |
| 复用性 | 可供任何项目使用 | 仅在 auto-dev-plugin 目录下可用 |
| 维护性 | 独立版本管理，不影响 auto-dev | 与 auto-dev 耦合，版本一起发布 |
| 部署 | 需单独注册插件 | 无需额外注册 |
| 依赖 | 仅邮件相关依赖（nodemailer, imapflow） | 会增大 auto-dev 的依赖体积 |

**选择：方案 A — 独立 MCP 插件**

理由：邮件功能与 auto-dev 完全无关，独立插件更干净，可跨项目复用。

## 3. 技术方案

### 3.1 技术栈

- **Runtime:** Node.js (ESM)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **SMTP 发信:** `nodemailer`（成熟稳定，支持 Coremail/Exchange/所有标准 SMTP）
- **IMAP 收信:** `imapflow`（现代 IMAP 客户端，支持 IDLE、搜索、附件）
- **构建:** TypeScript + tsc
- **Schema 校验:** `zod`

### 3.2 目录结构

```
~/.claude/plugins/email-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # MCP Server 入口，注册所有工具
│   ├── smtp-client.ts    # SMTP 发信封装
│   ├── imap-client.ts    # IMAP 收信封装
│   └── types.ts          # 类型定义
└── dist/                 # 编译输出
```

### 3.3 MCP 工具定义

#### `email_send` — 发送邮件

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| to | string[] | 是 | 收件人列表 |
| subject | string | 是 | 邮件主题 |
| body | string | 是 | 邮件正文（支持 HTML） |
| cc | string[] | 否 | 抄送 |
| bcc | string[] | 否 | 密送 |
| is_html | boolean | 否 | 正文是否为 HTML，默认 false |
| attachments | object[] | 否 | 附件列表（path + filename） |

返回：发送结果（messageId、是否成功）

#### `email_list` — 列出邮件

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| folder | string | 否 | 文件夹名，默认 INBOX |
| limit | number | 否 | 返回数量，默认 20 |
| unread_only | boolean | 否 | 仅未读，默认 false |

返回：邮件摘要列表（uid、from、subject、date、is_read）

#### `email_read` — 读取邮件详情

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uid | number | 是 | 邮件 UID |
| folder | string | 否 | 文件夹名，默认 INBOX |

返回：邮件完整内容（from、to、cc、subject、date、body_text、body_html、attachments）

#### `email_search` — 搜索邮件

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词 |
| folder | string | 否 | 文件夹名，默认 INBOX |
| from | string | 否 | 发件人筛选 |
| since | string | 否 | 起始日期 (YYYY-MM-DD) |
| limit | number | 否 | 返回数量，默认 20 |

返回：匹配的邮件摘要列表

### 3.4 配置方式

通过环境变量配置，在 Claude Code 的 `settings.json` 中设置：

```json
{
  "mcpServers": {
    "email": {
      "command": "node",
      "args": ["~/.claude/plugins/email-mcp/dist/index.js"],
      "env": {
        "EMAIL_USER": "cuidayang@in.iflytek.com",
        "EMAIL_PASS": "xxx",
        "SMTP_HOST": "smtp.iflytek.com",
        "SMTP_PORT": "465",
        "IMAP_HOST": "imap.iflytek.com",
        "IMAP_PORT": "993"
      }
    }
  }
}
```

启动时自动检测连通性，如果 `smtp.iflytek.com` 不通则尝试 `smtp.in.iflytek.com`。

### 3.5 安全设计

1. **凭据不入代码** — 用户名密码通过环境变量传入，不写入任何文件
2. **发信确认** — `email_send` 工具需要用户在 Claude Code 中手动批准（MCP 工具默认行为）
3. **SSL 强制** — SMTP 和 IMAP 均使用 SSL/TLS 连接
4. **连接复用** — IMAP 连接按需建立，操作完成后关闭，避免长连接超时

## 4. 验收标准

- **AC-1:** `email_send` 能成功发送邮件到指定收件人，支持抄送和密送
- **AC-2:** `email_list` 能列出收件箱邮件，支持未读筛选和数量限制
- **AC-3:** `email_read` 能读取邮件完整内容（正文 + 附件列表）
- **AC-4:** `email_search` 能按关键词、发件人、日期搜索邮件
- **AC-5:** 凭据仅通过环境变量配置，代码中无硬编码敏感信息

## 5. 实现估算

| 文件 | 预估行数 |
|------|---------|
| src/index.ts | ~120 行 |
| src/smtp-client.ts | ~60 行 |
| src/imap-client.ts | ~100 行 |
| src/types.ts | ~30 行 |
| package.json + tsconfig.json | ~30 行 |
| **合计** | **~340 行** |
