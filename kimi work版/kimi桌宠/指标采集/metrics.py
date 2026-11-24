from collections import Counter, deque
import datetime as dt
import json
import math
import os
from pathlib import Path
import urllib.request


def iso(ms=None):
    return dt.datetime.fromtimestamp((ms or 0) / 1000, dt.timezone.utc).isoformat() if ms else dt.datetime.now(dt.timezone.utc).isoformat()


def metric(display, **extra):
    return {"display": display, **extra}


def cache_sample(usage):
    hit = usage.get("inputCacheRead", usage.get("cache_read_input_tokens", 0))
    written = usage.get("inputCacheCreation", usage.get("cache_creation_input_tokens", 0))
    uncached = usage.get("inputOther", usage.get("input_tokens", usage.get("input", 0)))
    if not any(key in usage for key in (
        "inputOther", "inputCacheRead", "inputCacheCreation",
        "cache_read_input_tokens", "cache_creation_input_tokens",
    )):
        return None
    if not all(type(value) in (int, float) and math.isfinite(value) and value >= 0
               for value in (hit, written, uncached)):
        return None
    total = hit + written + uncached
    return (hit, total) if total > 0 else None


def read_wire(path):
    counts = {"turns": 0, "steps": 0, "toolCalls": 0, "compactions": 0, "fullCompactions": 0}
    context = None
    latest_request = None
    speed = None
    latest_time = 0
    cache_samples = deque(maxlen=5)
    loaded_skills = set()
    current_turn = None
    tools_by_turn = Counter()
    seen_tools = set()
    active_tools = {}
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(record, dict):
                continue
            kind = record.get("type")
            event = record.get("event", {}) if kind == "context.append_loop_event" else {}
            if not isinstance(event, dict):
                event = {}
            event_kind = event.get("type")
            if kind in {"turn.prompt", "agent.turn.started"} or event_kind == "step.begin":
                turn_id = event.get("turnId") if event_kind == "step.begin" else record.get("turnId")
                if turn_id is not None:
                    current_turn = str(turn_id)
            if kind == "agent.turn.started":
                counts["turns"] += 1
            elif event_kind == "step.begin":
                counts["steps"] += 1
            elif event_kind == "tool.call":
                tool_id = event.get("toolCallId") or event.get("uuid")
                turn_id = event.get("turnId")
                turn = str(turn_id) if turn_id is not None else current_turn
                if not tool_id or tool_id not in seen_tools:
                    counts["toolCalls"] += 1
                    if turn is not None:
                        tools_by_turn[turn] += 1
                    if tool_id:
                        seen_tools.add(tool_id)
                        name = event.get("name")
                        active_tools[tool_id] = (turn, name if isinstance(name, str) and name else None)
            elif event_kind == "tool.result":
                active_tools.pop(event.get("toolCallId") or event.get("parentUuid"), None)
            elif kind in {"turn.ended", "agent.turn.ended"} and record.get("turnId") is not None:
                ended = str(record["turnId"])
                active_tools = {key: call for key, call in active_tools.items() if call[0] != ended}
            elif kind == "context.append_message":
                message = record.get("message")
                origin = message.get("origin") if isinstance(message, dict) else None
                if isinstance(origin, dict) and origin.get("kind") == "skill_activation":
                    name = origin.get("skillName")
                    if isinstance(name, str) and name.strip():
                        loaded_skills.add(name.strip())
            elif kind == "context.apply_compaction":
                counts["compactions"] += 1
            elif kind == "full_compaction.complete":
                counts["fullCompactions"] += 1
            elif kind == "token_counting.measured":
                tokens = record.get("tokens")
                if isinstance(tokens, int):
                    context = tokens
            if kind == "llm.request" and record.get("kind") == "loop":
                latest_request = record.get("time")
            elif kind == "usage.record" and record.get("usageScope") == "turn":
                usage = record.get("usage")
                if not isinstance(usage, dict):
                    usage = {}
                sample = cache_sample(usage)
                if sample is not None:
                    cache_samples.append(sample)
                if latest_request:
                    end = record.get("time")
                    output = usage.get("output")
                    elapsed = (end - latest_request) / 1000 if isinstance(end, (int, float)) else 0
                    if elapsed > 0 and isinstance(output, (int, float)):
                        speed = {"tokensPerSecond": round(output / elapsed, 1), "outputTokens": output, "elapsedSeconds": round(elapsed, 2), "at": iso(end)}
                    latest_request = None
            if isinstance(record.get("time"), (int, float)):
                latest_time = max(latest_time, record["time"])
    hit_tokens = sum(hit for hit, _ in cache_samples)
    input_tokens = sum(total for _, total in cache_samples)
    cache_percent = hit_tokens / input_tokens * 100 if input_tokens else None
    skill_names = sorted(loaded_skills)
    turn_calls = tools_by_turn.get(current_turn, 0)
    active_names = list(dict.fromkeys(name for turn, name in active_tools.values()
                                      if turn == current_turn and name))
    metrics = {
        "context": metric(f"{context:,} tokens" if context is not None else "暂无测量值", value=context, unit="tokens", source="wire.jsonl"),
        "compactions": metric(f"{counts['compactions']} 次", **counts, source="wire.jsonl"),
        "steps": metric(f"{counts['turns']} 轮 · {counts['steps']} 步", **counts, source="wire.jsonl"),
        "speed": metric(f"{speed['tokensPerSecond']} tokens/s（最近请求均值）" if speed else "暂无可计算区间", **(speed or {}), status="available" if speed else "unavailable"),
        "cacheHit": metric(
            f"{cache_percent:.1f}%" if cache_percent is not None else "暂无缓存用量",
            percent=cache_percent, samples=len(cache_samples),
            hitTokens=hit_tokens, inputTokens=input_tokens, source="wire.jsonl"),
        "loadedSkills": metric(f"{len(skill_names)} 个", count=len(skill_names),
                               names=skill_names, source="wire.jsonl"),
        "tools": metric(f"{turn_calls} / {counts['toolCalls']}",
                        turnCalls=turn_calls, totalCalls=counts["toolCalls"],
                        activeNames=active_names, source="wire.jsonl"),
    }
    return metrics, latest_time


def read_quota():
    token = os.environ.get("KIMI_API_KEY") or os.environ.get("KIMI_CODE_API_KEY")
    if not token:
        return metric("需要登录", status="unavailable", reason="credential_not_found")
    request = urllib.request.Request("https://api.kimi.com/coding/v1/usages", headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.load(response)
        usages = data.get("usages") or {}
        labels = [("limit_5h", "5 小时"), ("limit_month_total", "月度"), ("limit_month_code", "月度 Coding")]
        values = []
        windows = {}
        for key, label in labels:
            item = usages.get(key)
            if isinstance(item, dict) and isinstance(item.get("used_ratio"), (int, float)):
                remaining = max(0.0, min(100.0, (1 - item["used_ratio"]) * 100))
                values.append(f"{label} {remaining:.1f}%")
                windows[key] = {"remainingPercent": round(remaining, 2), "resetTime": item.get("reset_time")}
        if not values and isinstance(data.get("usage"), dict):
            item = data["usage"]
            values.append(f"剩余 {item.get('remaining', '未知')}")
            windows["usage"] = {k: item.get(k) for k in ("limit", "used", "remaining", "resetTime")}
        for item in data.get("limits") or []:
            detail = item.get("detail") or {}
            if detail.get("remaining") is not None:
                values.append(f"限额计数 {detail['remaining']}/{detail.get('limit', '?')}")
                windows["limits"] = {"remaining": detail.get("remaining"), "limit": detail.get("limit"), "resetTime": detail.get("resetTime")}
                break
        return metric(" · ".join(values) if values else "接口未返回可识别额度", status="available" if values else "unavailable", windows=windows, source="https://api.kimi.com/coding/v1/usages")
    except Exception as error:
        return metric("额度读取失败", status="unavailable", reason=type(error).__name__)


def run(ctx):
    inp = ctx.get("input") or {}
    if inp.get("wirePath"):
        path = Path(inp["wirePath"])
    else:
        sessions = Path.home() / "AppData/Roaming/kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/sessions"
        candidates = list(sessions.glob("*/**/agents/main/wire.jsonl"))
        if not candidates:
            raise RuntimeError("未找到当前会话 wire.jsonl")
        path = max(candidates, key=lambda p: p.stat().st_mtime)
    metrics, latest_time = read_wire(path)
    metrics["quota"] = read_quota() if inp.get("refreshQuota", True) else metric("本次未刷新", status="skipped")
    return {"artifact": {"metrics": metrics, "scope": "current_conversation", "sessionId": path.parent.parent.parent.name, "asOf": iso(), "sourceUpdatedAt": iso(latest_time), "stale": False}}
