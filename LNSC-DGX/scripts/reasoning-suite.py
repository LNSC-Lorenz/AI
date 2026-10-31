#!/usr/bin/env python3
"""LNSC-DGX：确定性理解/推理/长上下文测试，保存原始响应与评分。"""
import argparse, hashlib, json, os, re, time, urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/")
MODEL = os.environ.get("MODEL")


def chat(prompt, max_tokens=4096):
    body = {"messages": [{"role": "user", "content": prompt}],
            "temperature": 0, "max_tokens": max_tokens, "stream": False}
    if MODEL:
        body["model"] = MODEL
    req = urllib.request.Request(BASE + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=900) as r:
        data = json.loads(r.read().decode())
    return data, round(time.monotonic() - started, 3)


def parse_json(text):
    text = re.sub(r"^```(?:json)?\s*|```$", "", text.strip(), flags=re.S)
    return json.loads(text[text.index("{"):text.rindex("}") + 1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    words = ("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi "
             "omicron pi rho sigma tau upsilon phi chi psi omega").split()
    filler = [words[i % len(words)] for i in range(20000)]
    for pos, text in ((2000, "RECORD ALPHA = NX-7319"),
                      (10000, "RECORD BETA = QZ-2048"),
                      (18000, "RECORD GAMMA = LM-8864")):
        filler.insert(pos, f"\n{text}\n")
    filler.insert(19500, "\nDECOY ALPHA = XX-0000\n")
    long_text = " ".join(filler)

    tasks = [
        {"name": "math_latency", "prompt":
         "某请求两阶段串行。阶段 A 处理 38,976 tokens，优化前速度 950 tokens/s，优化后 1,050 tokens/s。"
         "阶段 B 生成 512 tokens，速度 25 tokens/s，不变。计算优化前总秒数、优化后总秒数、节省秒数，"
         "均四舍五入到两位小数。只输出 JSON：{\"before_s\":数字,\"after_s\":数字,\"saved_s\":数字}",
         "check": lambda x: all(abs(float(x[k]) - v) < 0.001 for k, v in
                                (("before_s", 61.51), ("after_s", 57.60), ("saved_s", 3.91)))},
        {"name": "logic_order", "prompt":
         "四个任务 A、B、C、D 排在四个连续时段，每个任务恰好一次。约束：A 在 B 之前；B 在 C 之前；"
         "C 不在第一也不在第四；D 在 A 之后。求唯一顺序。只输出 JSON：{\"order\":[字母数组]}",
         "check": lambda x: x.get("order") == ["A", "B", "C", "D"]},
        {"name": "sql_null", "prompt":
         "表 t 的行依次为：(id=1,score=80)、(2,NULL)、(3,90)、(4,70)、(5,NULL)。"
         "按 SQL 聚合语义，COUNT(score) 只数非 NULL，AVG(score) 忽略 NULL，COUNT(*) 数全部行。"
         "只输出 JSON：{\"count_score\":数字,\"avg_score\":数字,\"sum_score\":数字,\"count_rows\":数字}",
         "check": lambda x: (x.get("count_score") == 3 and float(x.get("avg_score")) == 80.0
                             and x.get("sum_score") == 240 and x.get("count_rows") == 5)},
        {"name": "chinese_incident_nlu", "prompt":
         "阅读事件：09:00 CPU 与内存稳定。09:02 一个 prompt_tokens=38972 的请求正在 prefill，"
         "实测速度约 1050 tokens/s，服务端没有异常日志；随后客户端达到自己的超时并发送 cancel。"
         "重发相同 prompt 后 38900 个前缀 token 命中缓存，0.3 秒开始输出。"
         "判断直接事件、是否存在服务端故障、主要耗时来源、缓存是否有效。"
         "只输出 JSON：{\"immediate_event\":\"client_cancel\"或\"server_crash\","
         "\"server_fault\":true或false,\"main_cost\":\"cold_prefill\"或\"decode\","
         "\"cache_effective\":true或false}",
         "check": lambda x: (x.get("immediate_event") == "client_cancel" and x.get("server_fault") is False
                             and x.get("main_cost") == "cold_prefill" and x.get("cache_effective") is True)},
        {"name": "long_context_records", "max_tokens": 2048, "prompt":
         "阅读下面的长文本。找出三条以 RECORD 开头的记录，忽略 DECOY。只输出 JSON："
         "{\"alpha\":\"对应代码\",\"beta\":\"对应代码\",\"gamma\":\"对应代码\"}\n\n" + long_text,
         "check": lambda x: (x.get("alpha") == "NX-7319" and x.get("beta") == "QZ-2048"
                             and x.get("gamma") == "LM-8864")},
    ]

    results = []
    for task in tasks:
        data, wall = chat(task["prompt"], task.get("max_tokens", 4096))
        name = task["name"]
        with open(os.path.join(args.out, name + ".json"), "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        m = data["choices"][0]["message"]
        actual, passed, error = None, False, None
        try:
            actual = parse_json(m.get("content") or "")
            passed = bool(task["check"](actual))
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
        result = {"task": name, "passed": passed, "wall_s": wall,
                  "finish_reason": data["choices"][0].get("finish_reason"),
                  "prompt_tokens": (data.get("usage") or {}).get("prompt_tokens"),
                  "completion_tokens": (data.get("usage") or {}).get("completion_tokens"),
                  "reasoning_chars": len(m.get("reasoning_content") or ""),
                  "content_chars": len(m.get("content") or ""),
                  "actual": actual, "error": error}
        results.append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)

    summary = {"label": args.label, "passed": sum(x["passed"] for x in results),
               "total": len(results), "long_prompt_sha256": hashlib.sha256(long_text.encode()).hexdigest(),
               "results": results}
    with open(os.path.join(args.out, "reasoning-summary.json"), "w") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(json.dumps({"passed": summary["passed"], "total": summary["total"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
