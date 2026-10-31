#!/usr/bin/env python3
"""LNSC-DGX：Cline 类工具调用与代码任务 A/B；模型代码隔离降权运行。"""
import argparse, json, os, re, resource, shutil, subprocess, sys, tempfile, time, urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/")
MODEL = os.environ.get("MODEL")


def chat(messages, tools=None, max_tokens=16384):
    body = {"messages": messages, "temperature": 0, "max_tokens": max_tokens, "stream": False}
    if MODEL:
        body["model"] = MODEL
    if tools:
        body.update(tools=tools, tool_choice="auto")
    req = urllib.request.Request(BASE + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=900) as r:
        data = json.loads(r.read().decode())
    data["_ab_wall_s"] = round(time.monotonic() - started, 3)
    return data


def message(data):
    return data["choices"][0]["message"]


def text_of(data):
    return message(data).get("content") or ""


def unfenced(text):
    text = text.strip()
    m = re.fullmatch(r"```(?:python|json)?\s*\n(.*?)```", text, re.S)
    return m.group(1).strip() if m else text


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024**2, 2 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))


def run_tests(workdir):
    for exe in ("unshare", "setpriv"):
        if not shutil.which(exe):
            return {"passed": False, "error": f"缺少沙箱工具 {exe}，未执行模型代码"}
    cmd = ["unshare", "--net", "--", "setpriv", "--reuid=65534", "--regid=65534",
           "--clear-groups", "python3", "-B", "tests.py"]
    try:
        p = subprocess.run(cmd, cwd=workdir, text=True, capture_output=True,
                           timeout=40, preexec_fn=limits,
                           env={"PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"})
        return {"passed": p.returncode == 0, "returncode": p.returncode,
                "stdout": p.stdout[-4000:], "stderr": p.stderr[-4000:]}
    except Exception as e:
        return {"passed": False, "error": f"{type(e).__name__}: {e}"}


def workspace(files):
    d = tempfile.mkdtemp(prefix="lnsc-ab-quality-")
    for name, content in files.items():
        with open(os.path.join(d, name), "w") as f:
            f.write(content)
    for root, dirs, files_ in os.walk(d):
        os.chmod(root, 0o755)
        for name in files_:
            os.chmod(os.path.join(root, name), 0o644)
    return d


def save(out, name, data):
    with open(os.path.join(out, name + ".json"), "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


MERGE_SRC = '''def merge_intervals(intervals):
    intervals.sort()
    merged = [intervals[0]]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged
'''
MERGE_TEST = '''from merge import merge_intervals
assert merge_intervals([]) == []
assert merge_intervals([[3, 4], [1, 2]]) == [[1, 2], [3, 4]]
assert merge_intervals([[1, 10], [2, 3], [4, 5]]) == [[1, 10]]
assert merge_intervals([[1, 2], [2, 3], [5, 6]]) == [[1, 3], [5, 6]]
src = [[3, 4], [1, 2]]; original = [x[:] for x in src]
merge_intervals(src); assert src == original, "不得修改输入"
print("merge tests: PASS")
'''
MONEY_SRC = '''def total_cents(items):
    return sum(item["price"] * item["qty"] for item in items)
'''
REPORT_SRC = '''from money import total_cents

def build_report(items):
    cents = total_cents(items)
    return {"total_cents": cents, "total": f"{cents / 100:.2f}"}
'''
REFACTOR_TEST = '''from money import total_cents, format_cents
from report import build_report
items = [{"price": "19.99", "qty": 3}, {"price": "0.10", "qty": 3}]
assert total_cents(items) == 6027
assert total_cents([]) == 0
assert format_cents(6027) == "60.27"
assert format_cents(5) == "0.05"
assert format_cents(-5) == "-0.05"
assert build_report(items) == {"total_cents": 6027, "total": "60.27"}
print("refactor tests: PASS")
'''
TOOLS = [{"type": "function", "function": {
    "name": "read_file", "description": "读取工作区文本文件",
    "parameters": {"type": "object", "properties": {
        "path": {"type": "string", "description": "绝对文件路径"}},
        "required": ["path"], "additionalProperties": False}}}]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    results = []

    prompt = "请检查 `/workspace/src/app.py`。必须先调用 read_file 读取它；未读取前不要给结论。"
    data = chat([{"role": "user", "content": prompt}], TOOLS, 512)
    save(args.out, "tool-call", data)
    calls = message(data).get("tool_calls") or []
    ok = False
    for c in calls:
        if (c.get("function") or {}).get("name") == "read_file":
            try:
                ok |= json.loads(c["function"].get("arguments") or "{}").get("path") == "/workspace/src/app.py"
            except Exception:
                pass
    results.append({"task": "tool_call", "passed": bool(ok), "wall_s": data["_ab_wall_s"]})

    prompt = ("修复下面 merge.py。要求：支持空列表和乱序输入；正确合并重叠、相接及嵌套区间；"
              "不得修改调用方传入的列表；只使用标准库。只输出完整 Python 文件，不要解释。\n\n" + MERGE_SRC)
    data = chat([{"role": "user", "content": prompt}])
    save(args.out, "bugfix", data)
    code = unfenced(text_of(data))
    d = workspace({"merge.py": code, "tests.py": MERGE_TEST})
    r = run_tests(d)
    r.update(task="bugfix_merge", wall_s=data["_ab_wall_s"])
    results.append(r)

    prompt = ("修改以下两个文件：money.py 的 total_cents 必须接受十进制字符串 price 和整数 qty，"
              "用 Decimal 精确计算并返回整数分；新增 format_cents(cents)，正确格式化正数、零和负数，"
              "例如 5 -> '0.05'，-5 -> '-0.05'。report.py 必须复用 format_cents。"
              "只输出 JSON 对象，键为 money.py 和 report.py，值为两个完整文件内容，不要 Markdown。\n\n"
              "money.py:\n" + MONEY_SRC + "\nreport.py:\n" + REPORT_SRC)
    data = chat([{"role": "user", "content": prompt}])
    save(args.out, "refactor", data)
    try:
        raw = unfenced(text_of(data))
        files = json.loads(raw[raw.index("{"):raw.rindex("}") + 1])
        d = workspace({"money.py": files["money.py"], "report.py": files["report.py"],
                       "tests.py": REFACTOR_TEST})
        r = run_tests(d)
    except Exception as e:
        r = {"passed": False, "error": f"输出解析失败: {type(e).__name__}: {e}"}
    r.update(task="cross_file_decimal_refactor", wall_s=data["_ab_wall_s"])
    results.append(r)

    summary = {"label": args.label, "passed": sum(bool(x["passed"]) for x in results),
               "total": len(results), "results": results}
    save(args.out, "quality-summary", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"AB-QUALITY ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

