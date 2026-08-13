"""
astrbot_plugin_kook_manager - KOOK 机器人消息管理插件

在 AstrBot WebUI 中提供一个管理面板：
- 查看机器人已加入的服务器与文字频道
- 查看频道内机器人自己发送的消息（最新在底部）
- 搜索 / 过滤消息（文本、图片、表情、卡片等）
- 一键删除某条机器人消息（调用 KOOK API 撤回）

凭据获取优先级：
1. 插件数据目录下的 kook_manager_config.json 中手动填写的 token（覆盖）
2. AstrBot KOOK 适配器实例中读取的 kook_bot_token
3. AstrBot 全局配置中 platform_settings 下的 kook_bot_token
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import aiohttp

from astrbot.api.star import Context, Star
from astrbot.api.web import error_response, json_response, request
from astrbot.core.utils.astrbot_path import get_astrbot_plugin_data_path

PLUGIN_NAME = "astrbot_plugin_kook_manager"

# KOOK API 基址与端点
KOOK_API_BASE = "https://www.kookapp.cn/api/v3"
KOOK_ENDPOINTS = {
    "user_me": "/user/me",
    "guild_list": "/guild/list",
    "channel_list": "/channel/list",
    "message_list": "/message/list",
    "message_delete": "/message/delete",
}


def _plugin_data_dir() -> Path:
    """插件数据目录（持久化，重装插件不丢失）。"""
    base = Path(get_astrbot_plugin_data_path())
    target = base / "astrbot_plugin_kook_manager"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _load_override_config() -> dict:
    """读取插件数据目录中的手动覆盖配置。"""
    path = _plugin_data_dir() / "kook_manager_config.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_override_config(cfg: dict) -> None:
    """保存插件数据目录中的手动覆盖配置。"""
    path = _plugin_data_dir() / "kook_manager_config.json"
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


class KookManagerPlugin(Star):
    def __init__(self, context: Context, config: dict | None = None):
        super().__init__(context, config)
        self._http: aiohttp.ClientSession | None = None
        self._cached_self_id: str = ""
        self._cached_token: str = ""

        context.register_web_api(
            f"/{PLUGIN_NAME}/status",
            self._api_status,
            ["GET"],
            "获取插件与凭据状态",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/config",
            self._api_get_config,
            ["GET"],
            "获取当前生效的凭据配置",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/config/save",
            self._api_save_config,
            ["POST"],
            "保存手动覆盖的凭据配置",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/guilds",
            self._api_guilds,
            ["GET"],
            "获取机器人已加入的服务器与文字频道",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/messages",
            self._api_messages,
            ["GET"],
            "获取某频道内机器人发送的消息",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/messages/delete",
            self._api_delete_message,
            ["POST"],
            "删除（撤回）某条机器人消息",
        )

    # ------------------------------------------------------------------ #
    # 工具方法
    # ------------------------------------------------------------------ #

    async def _get_http(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession()
        return self._http

    async def _get_token(self) -> tuple[str | None, str]:
        """返回 (token, 来源说明)。来源: override / adapter / global_config。"""
        # 1. 插件数据目录手动覆盖
        ov = _load_override_config()
        ov_token = (ov.get("token") or "").strip()
        if ov_token:
            return ov_token, "override"

        # 2. KOOK 适配器实例
        try:
            for inst in self.context.platform_manager.platform_insts:
                meta = inst.meta()
                if meta.name == "kook" or meta.id == "kook":
                    kc = getattr(inst, "kook_config", None)
                    if kc is not None:
                        token = (getattr(kc, "token", "") or "").strip()
                        if token:
                            return token, "adapter"
                    raw = getattr(inst, "config", None) or {}
                    token = (raw.get("kook_bot_token") or "").strip()
                    if token:
                        return token, "adapter"
        except Exception:
            pass

        # 3. AstrBot 全局配置
        try:
            cfg = self.context.get_config()
            if hasattr(cfg, "get"):
                # 平台配置存储于 cfg["platform"] 列表，每个条目包含 type/id 与平台专属字段
                platforms = cfg.get("platform") or []
                if isinstance(platforms, list):
                    for entry in platforms:
                        if not isinstance(entry, dict):
                            continue
                        if entry.get("type") == "kook" or entry.get("id") == "kook":
                            token = (entry.get("kook_bot_token") or "").strip()
                            if token:
                                return token, "global_config"
                            break
        except Exception:
            pass

        return None, "none"

    async def _request(
        self,
        method: str,
        endpoint: str,
        token: str,
        params: dict | None = None,
        json_body: dict | None = None,
    ) -> dict:
        """向 KOOK API 发起请求，返回解析后的 JSON dict。"""
        http = await self._get_http()
        url = KOOK_API_BASE + endpoint
        headers = {"Authorization": f"Bot {token}"}
        async with http.request(
            method, url, headers=headers, params=params, json=json_body
        ) as resp:
            try:
                data = await resp.json()
            except Exception:
                text = await resp.text()
                raise RuntimeError(f"KOOK API 返回非 JSON: HTTP {resp.status} {text[:200]}")
        if not isinstance(data, dict):
            raise RuntimeError(f"KOOK API 返回异常结构: {data!r}")
        code = data.get("code", -1)
        if code != 0:
            msg = data.get("message") or data.get("msg") or "未知错误"
            raise RuntimeError(f"KOOK API 错误(code={code}): {msg}")
        return data.get("data") or {}

    async def _get_self_id(self, token: str) -> str:
        """获取机器人自身 ID（带缓存，token 变化时自动失效）。"""
        if self._cached_self_id and self._cached_token == token:
            return self._cached_self_id
        data = await self._request("GET", KOOK_ENDPOINTS["user_me"], token)
        self._cached_self_id = str(data.get("id", ""))
        self._cached_token = token
        return self._cached_self_id

    # ------------------------------------------------------------------ #
    # 消息解析：把 KOOK 消息渲染成前端友好的结构
    # ------------------------------------------------------------------ #

    @staticmethod
    def _parse_content(msg: dict) -> list[dict]:
        """将 KOOK 消息 content 解析为片段列表（文本/图片/表情等）。

        返回片段形如:
          {"kind": "text", "text": "..."}
          {"kind": "image", "url": "..."}
          {"kind": "emoji", "text": "..."}   # 系统表情
        """
        msg_type = msg.get("type")
        content = msg.get("content") or ""
        attachments = msg.get("attachments")
        segments: list[dict] = []

        # 纯文本类：1=文本, 9=kmarkdown
        if msg_type in (1, 9):
            if content:
                segments.append({"kind": "text", "text": content})
        # 图片类：2=图片, 3=视频
        elif msg_type == 2:
            segments.append({"kind": "image", "url": content})
        elif msg_type == 3:
            segments.append({"kind": "video", "url": content})
        # 文件：4=文件, 8=音频
        elif msg_type == 4:
            segments.append({"kind": "file", "url": content})
        elif msg_type == 8:
            segments.append({"kind": "audio", "url": content})
        # 卡片消息：10
        elif msg_type == 10:
            try:
                cards = json.loads(content) if isinstance(content, str) else content
                if isinstance(cards, list):
                    for card in cards:
                        for module in card.get("modules", []):
                            mtype = module.get("type")
                            if mtype == "section":
                                text = module.get("text", {}).get("content", "")
                                if text:
                                    segments.append({"kind": "text", "text": text})
                            elif mtype in ("image-group", "container"):
                                for el in module.get("elements", []):
                                    src = el.get("src") if isinstance(el, dict) else None
                                    if src:
                                        segments.append({"kind": "image", "url": src})
                            elif mtype == "header":
                                text = module.get("text", {}).get("content", "")
                                if text:
                                    segments.append({"kind": "text", "text": text})
                            elif mtype == "context":
                                for el in module.get("elements", []):
                                    if isinstance(el, dict) and el.get("type") == "image":
                                        segments.append({"kind": "image", "url": el.get("src", "")})
                                    elif isinstance(el, dict) and el.get("content"):
                                        segments.append({"kind": "text", "text": el.get("content", "")})
            except Exception:
                segments.append({"kind": "text", "text": content or "[卡片消息]"})

        # 附件（图片/文件/视频）
        if attachments:
            att_type = attachments.get("type")
            att_url = attachments.get("url")
            if att_url:
                if att_type == "video":
                    segments.append({"kind": "video", "url": att_url})
                elif att_type == "file":
                    segments.append({"kind": "file", "url": att_url, "name": attachments.get("name", "")})
                else:
                    segments.append({"kind": "image", "url": att_url})

        if not segments:
            segments.append({"kind": "text", "text": content or "[空消息]"})
        return segments

    @staticmethod
    def _msg_search_text(msg: dict, segments: list[dict]) -> str:
        """构造用于搜索过滤的文本（含表情标记）。"""
        parts: list[str] = []
        if msg.get("content"):
            parts.append(str(msg["content"]))
        for seg in segments:
            if seg["kind"] == "text":
                parts.append(str(seg["text"]))
            elif seg["kind"] == "image":
                parts.append("[图片]")
            elif seg["kind"] == "emoji":
                parts.append(str(seg.get("text", "")))
            elif seg["kind"] == "video":
                parts.append("[视频]")
            elif seg["kind"] == "file":
                parts.append("[文件]")
            elif seg["kind"] == "audio":
                parts.append("[音频]")
        return " ".join(parts)

    # ------------------------------------------------------------------ #
    # Web API Handlers
    # ------------------------------------------------------------------ #

    async def _api_status(self):
        token, source = await self._get_token()
        bot_name = ""
        self_id = ""
        if token:
            try:
                data = await self._request("GET", KOOK_ENDPOINTS["user_me"], token)
                self_id = str(data.get("id", ""))
                bot_name = data.get("nickname") or data.get("username") or ""
            except Exception as e:
                return json_response(
                    {
                        "ok": False,
                        "token_source": source,
                        "error": str(e),
                        "message": f"凭据验证失败: {e}",
                    }
                )
        return json_response(
            {
                "ok": bool(token),
                "token_source": source,
                "bot_id": self_id,
                "bot_name": bot_name,
            }
        )

    async def _api_get_config(self):
        ov = _load_override_config()
        token, source = await self._get_token()
        return json_response(
            {
                "override": ov,
                "effective_source": source,
                "has_token": bool(token),
                "token_masked": (token[:4] + "****" + token[-4:]) if token else "",
            }
        )

    async def _api_save_config(self):
        payload = await request.json(default={})
        if not isinstance(payload, dict):
            return error_response("请求体必须是 JSON 对象")
        token = (payload.get("token") or "").strip()
        # 允许清空覆盖：传空 token 则删除覆盖配置
        if token:
            _save_override_config({"token": token})
        else:
            _save_override_config({})
        return json_response({"ok": True})

    async def _api_guilds(self):
        token, source = await self._get_token()
        if not token:
            return error_response("未找到 KOOK 机器人 Token，请先在插件配置页填写。")

        try:
            self_id = await self._get_self_id(token)
            # 服务器列表
            guild_data = await self._request("GET", KOOK_ENDPOINTS["guild_list"], token, {"page_size": 100})
            guilds = guild_data.get("items", [])

            result = []
            for guild in guilds:
                gid = guild.get("id")
                if not gid:
                    continue
                # 该服务器的文字频道
                try:
                    ch_data = await self._request(
                        "GET", KOOK_ENDPOINTS["channel_list"], token,
                        {"guild_id": gid, "type": 1, "page_size": 100},
                    )
                    channels = ch_data.get("items", [])
                except Exception:
                    channels = []
                text_channels = [
                    {
                        "id": c.get("id"),
                        "name": c.get("name"),
                        "parent_id": c.get("parent_id", ""),
                        "is_category": bool(c.get("is_category", False)),
                        "level": c.get("level", 0),
                    }
                    for c in channels
                    if c.get("type") == 1 and not c.get("is_category")
                ]
                result.append(
                    {
                        "id": gid,
                        "name": guild.get("name", ""),
                        "icon": guild.get("icon", ""),
                        "channels": text_channels,
                    }
                )
            return json_response({"ok": True, "guilds": result, "self_id": self_id})
        except Exception as e:
            return error_response(f"获取服务器/频道失败: {e}")

    async def _api_messages(self):
        token, source = await self._get_token()
        if not token:
            return error_response("未找到 KOOK 机器人 Token。")
        channel_id = request.query.get("channel_id", "")
        if not channel_id:
            return error_response("缺少 channel_id 参数。")

        # 分页参数
        page_size = request.query.get("page_size", 50, type=int)
        page_size = min(max(page_size, 1), 100)
        # 参考消息 id（用于 before 分页）
        msg_id = request.query.get("msg_id", "")

        try:
            self_id = await self._get_self_id(token)
            params: dict[str, Any] = {
                "target_id": channel_id,
                "page_size": page_size,
            }
            if msg_id:
                params["msg_id"] = msg_id
                params["flag"] = "before"

            data = await self._request("GET", KOOK_ENDPOINTS["message_list"], token, params)
            items = data.get("items", [])

            messages = []
            for m in items:
                author_id = str(m.get("author", {}).get("id", ""))
                # 仅保留机器人自己的消息
                if not self_id or author_id != self_id:
                    continue
                segments = self._parse_content(m)
                messages.append(
                    {
                        "id": m.get("id"),
                        "type": m.get("type"),
                        "create_at": m.get("create_at"),
                        "author": m.get("author", {}).get("username", "机器人"),
                        "segments": segments,
                        "search_text": self._msg_search_text(m, segments),
                    }
                )

            # 升序返回（最早的在前，最新在底部）
            messages.sort(key=lambda x: x.get("create_at") or 0)

            has_more = len(items) >= page_size
            return json_response(
                {
                    "ok": True,
                    "self_id": self_id,
                    "messages": messages,
                    "has_more": has_more,
                }
            )
        except Exception as e:
            return error_response(f"获取消息失败: {e}")

    async def _api_delete_message(self):
        token, source = await self._get_token()
        if not token:
            return error_response("未找到 KOOK 机器人 Token。")
        payload = await request.json(default={})
        if not isinstance(payload, dict):
            return error_response("请求体必须是 JSON 对象")

        # 兼容单条 msg_id 与批量 msg_ids 两种写法
        msg_ids = payload.get("msg_ids") or []
        if isinstance(msg_ids, str):
            msg_ids = [msg_ids]
        elif not isinstance(msg_ids, list):
            msg_ids = []
        msg_id = (payload.get("msg_id") or "").strip()
        if msg_id and msg_id not in msg_ids:
            msg_ids.insert(0, msg_id)

        cleaned: list[str] = []
        for mid in msg_ids:
            if isinstance(mid, str) and mid.strip() and mid.strip() not in cleaned:
                cleaned.append(mid.strip())
        if not cleaned:
            return error_response("缺少 msg_id 参数。")

        deleted = 0
        failed: list[dict] = []
        for mid in cleaned:
            try:
                await self._request(
                    "POST", KOOK_ENDPOINTS["message_delete"], token,
                    json_body={"msg_id": mid},
                )
                deleted += 1
            except Exception as e:
                failed.append({"id": mid, "error": str(e)})

        if deleted == 0 and failed:
            return error_response(f"删除消息失败: {failed[0]['error']}")
        return json_response(
            {
                "ok": True,
                "deleted": deleted,
                "failed": failed,
            }
        )

    # ------------------------------------------------------------------ #
    # 生命周期
    # ------------------------------------------------------------------ #

    async def terminate(self):
        if self._http and not self._http.closed:
            await self._http.close()
