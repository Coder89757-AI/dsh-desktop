# dsh-plugin-legal-kb

[English](README.md) | 中文

法律知识库插件：侧边栏入口 + 授权码连接的法律知识库 MCP 工具桥接。

## 功能

- **Host**：`legal-kb-bridge` Cordis 插件。注册 `legal-kb` settings namespace（服务地址与授权码，授权码标记 `role('secret')`）、三个私有同源路由（`/api/desktop/legal-kb/activate|status|disconnect`），并在授权码非空时以 `dsh-mcp-client`（Streamable HTTP + `Authorization: Bearer <授权码>`）挂载知识库 MCP 端点，将其工具以 `mcp__legal-kb__<tool>` 注册进 `ctx.tools`。授权码或端点变化时自动重挂载。
- **Client**：侧边栏底部"法律知识库"入口（宽栏文字 + 连接状态点，窄栏图标），点击弹出连接面板（授权码激活、身份/积分展示、断开连接），中英双语，配色与图标全部跟随 dsh 主题 token。

## 知识库服务端

插件对接 [lexford](https://gitee.com/coder89757/lexford) 项目的两个服务：

- `api_server.py`（默认 `http://127.0.0.1:8310`）：`POST /api/auth/activate` 授权码激活验证
- `mcp_server.py --http`（默认 `http://127.0.0.1:8300/mcp`）：法律检索 MCP 工具（需 `feat/dsh-legal-kb` 分支的用户级鉴权改造，支持授权码直接访问）

## 模型体验

连接成功后，模型可见 `mcp__legal-kb__search_laws`、`get_article`、`search_article_content`、`check_law_validity`、`get_law_structure`、`get_legal_basis`、`batch_verify_citations`、`get_database_stats`、`clear_caches` 共 9 个工具，schema 随系统提示词组装注入；断开连接或授权码失效时该工具世代被注销。

## 已知限制

- 服务地址修改目前仅在连接时由 Host 端 settings 默认值生效，面板高级区为展示用途。
- MCP 桥接沿用 `dsh-mcp-client` 的行为：连接失败进入自动重连，授权码错误在日志中可见。
