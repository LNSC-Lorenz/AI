#!/usr/bin/env python3
"""LNSC-DGX：两个 llama-server 顺序 A/B 的性能测试（不改服务配置）。

用法：python3 ab-perf.py --label flash --out /root/lnsc-ab/flash
可选：BASE=http://127.0.0.1:8081、--cold-runs 2、--target-tokens 39000
"""
import argparse, hashlib, json, os, sys, time, urllib.request, urllib.error


def get_json(base, path, timeout=10):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.loads(r.read().decode())


def post(base, messages, max_tokens, ignore_eos, timeout=900):
    body = {
        "messages": messages, "max_tokens": max_tokens,
        "temperature": 0, "stream": False,
    }
    model = os.environ.get("MODEL")
    if model:
        body["model"] = model
    if ignore_eos:
        body["ignore_eos"] = True       # llama.cpp 扩展：保证 decode 测满 N token
    req = urllib.request.Request(
        base + "/v1/chat/completions", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
            status = r.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code}: {detail[:1000]}") from e
    wall = time.monotonic() - started
    if "error" in data:
        raise RuntimeError(str(data["error"]))
    t = data.get("timings") or {}
    return data, {
        "http": status, "wall_s": round(wall, 3),
        "model": data.get("model"),
        "usage_prompt_tokens": (data.get("usage") or {}).get("prompt_tokens"),
        "usage_completion_tokens": (data.get("usage") or {}).get("completion_tokens"),
        "prompt_n": t.get("prompt_n"), "prompt_ms": t.get("prompt_ms"),
        "prefill_tps": t.get("prompt_per_second"),
        "predicted_n": t.get("predicted_n"), "predicted_ms": t.get("predicted_ms"),
        "decode_tps": t.get("predicted_per_second"),
    }


def wait_idle(base, seconds=90):
    deadline = time.monotonic() + seconds
    while True:
        try:
            slots = get_json(base, "/slots", 5)
            if not any(s.get("is_processing") for s in slots):
                return
        except Exception:
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError("服务一直忙，为避免污染基准而退出；请空闲时重跑")
        time.sleep(3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target-tokens", type=int, default=39000)
    ap.add_argument("--cold-runs", type=int, default=2)
    ap.add_argument("--session", help="两个模型使用同一值即可复现完全相同的 prompt")
    args = ap.parse_args()
    base = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/")
    os.makedirs(args.out, exist_ok=True)
    session = args.session or f"ab-{int(time.time())}"
    wait_idle(base)
    health = get_json(base, "/health")
    props = get_json(base, "/props")
    (open(os.path.join(args.out, "server.json"), "w")
     .write(json.dumps({"health": health, "props": props}, ensure_ascii=False, indent=2)))

    words = ("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi "
             "omicron pi rho sigma tau upsilon phi chi psi omega").split()
    body = " ".join(words[i % len(words)] for i in range(max(16, int(args.target_tokens / 1.17))))
    results = {"label": args.label, "base": base, "session": session,
               "target_tokens": args.target_tokens, "body_sha256": hashlib.sha256(body.encode()).hexdigest(),
               "body_chars": len(body), "runs": []}

    for i in range(args.cold_runs):
        # session 使本次 A/B 不命中旧 cache；同一 session 可供另一模型复现相同文本。
        messages = [{"role": "user", "content":
                     f"nonce {session}-cold-{i}\n{body}\n\n"
                     "Summarize the preceding text in detail and continue to the token limit."}]
        data, summary = post(base, messages, 512, True)
        summary.update(kind="cold_39k_plus_decode512", run=i,
                       request_sha256=hashlib.sha256(json.dumps(messages).encode()).hexdigest())
        results["runs"].append(summary)
        (open(os.path.join(args.out, f"cold-{i}.json"), "w")
         .write(json.dumps(data, ensure_ascii=False, indent=2)))
        print(json.dumps(summary, ensure_ascii=False), flush=True)

    # 与最后一次 cold 使用完全相同的 prompt，只把输出改成 1 token，测 cache 命中。
    messages = [{"role": "user", "content":
                 f"nonce {session}-cold-{args.cold_runs - 1}\n{body}\n\n"
                 "Summarize the preceding text in detail and continue to the token limit."}]
    data, summary = post(base, messages, 1, False)
    summary["kind"] = "warm_same_39k"
    results["runs"].append(summary)
    print(json.dumps(summary, ensure_ascii=False), flush=True)

    short = [{"role": "user", "content":
              f"nonce {session}-short\nExplain how to diagnose a flaky Python integration test. "
              "Give a systematic, detailed answer and continue to the token limit."}]
    data, summary = post(base, short, 512, True)
    summary["kind"] = "short_prompt_decode512"
    results["runs"].append(summary)
    (open(os.path.join(args.out, "decode512.json"), "w")
     .write(json.dumps(data, ensure_ascii=False, indent=2)))
    print(json.dumps(summary, ensure_ascii=False), flush=True)

    with open(os.path.join(args.out, "perf-summary.json"), "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"保存：{os.path.join(args.out, 'perf-summary.json')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"AB-PERF ERROR: {e}", file=sys.stderr)
        sys.exit(1)
