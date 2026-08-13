# astrbot_plugin_kook_manager

KOOK 机器人消息管理插件，运行于 AstrBot WebUI。

## 功能

- 在 AstrBot WebUI 中提供一个管理面板（Plugin Page）
- 展示机器人已加入的服务器与其中的**文字频道**，左侧频道树切换
- 查看频道内**机器人自己发送**的消息，按主流聊天软件样式排列，**最新消息在底部，打开自动滚动到底部**
- 搜索 / 过滤消息：支持关键词搜索，支持「仅图片」过滤（含机器人发送的图片、表情、卡片图片等）
- 一键删除（撤回）某条机器人消息
- **多选批量删除**：勾选消息后支持「全选 / 清空选择」，一键批量撤回选中的机器人消息

## 安装

1. 将本插件目录 `astrbot_plugin_kook_manager` 放到 AstrBot 的 `data/plugins/` 目录下。
2. 在 AstrBot WebUI「插件管理」中启用插件；如有依赖需要安装，请在「平台日志 → 安装 Pip 库」中安装 `requirements.txt` 列出的依赖（`aiohttp`）。
3. 在插件详情页打开「KOOK 消息管理」Page。

## 凭据配置

插件按以下顺序获取 KOOK 机器人 Token：

1. **插件页手动覆盖**：在管理面板顶部点击连接状态徽标，打开凭据弹层，填写机器人 Token（会持久化到 `data/plugin_data/astrbot_plugin_kook_manager/kook_manager_config.json`）。
2. **AstrBot KOOK 适配器**：若 AstrBot 中已启用 KOOK 平台适配器（配置了 `kook_bot_token`），插件自动读取。
3. **AstrBot 全局配置**：从 `data/cmd_config.json` 的 `platform` 列表中查找 `type` 为 `kook` 的条目。

通常无需手动填写；只有当 AstrBot 未启用 KOOK 适配器，或希望使用不同 Token 时才需要覆盖。

## 使用

- 左侧选择服务器下的文字频道，右侧加载该频道内机器人发送的消息。
- 点击消息右侧的「删除」按钮撤回该消息（调用 KOOK `/api/v3/message/delete`，仅能删除机器人自己的消息）。
- 点击消息左侧的复选框进行多选，工具栏「全选」可选中当前列表的全部消息（再次点击变为「清空选择」），「删除所选」可一键批量撤回勾选的消息。
- 顶部搜索框按内容过滤；「仅图片」按钮筛选图片消息；「自动滚动」保持列表始终停留在最新消息。

## 技术说明

- 后端：`main.py`，基于 AstrBot `Star` 插件框架，通过 `context.register_web_api()` 注册 API。
- 前端：`pages/kook-manager/`，通过 `window.AstrBotPluginPage` bridge 与 Dashboard 通信。
- 消息删除直接调用 KOOK 开放平台 API（适配器本身未提供撤回方法）。
- 白底主题，支持暗黑模式（跟随 AstrBot WebUI 主题）。

## API 端点

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/astrbot_plugin_kook_manager/status` | 凭据与连接状态 |
| GET | `/astrbot_plugin_kook_manager/config` | 当前生效凭据 |
| POST | `/astrbot_plugin_kook_manager/config/save` | 保存手动覆盖凭据 |
| GET | `/astrbot_plugin_kook_manager/guilds` | 服务器与文字频道列表 |
| GET | `/astrbot_plugin_kook_manager/messages` | 频道内机器人消息（分页） |
| POST | `/astrbot_plugin_kook_manager/messages/delete` | 删除（撤回）消息，支持单条 `msg_id` 或批量 `msg_ids` |

## 依赖

- `aiohttp>=3.8.0`
