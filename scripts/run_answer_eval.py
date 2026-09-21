"""P13 fixed live-LLM regression runner.

Runs every question in evals/p13_answer_eval.json through the real
path (orchestrator -> routing -> tools -> structured context ->
synthesize -> final answer), records tools/windows/counts/answer/
citations/latency, applies the deterministic checks from
services.evaluation.checks, and writes a results file.

Provider/DB failure per question is recorded as BLOCKED — never
mocked. Re-runnable: `venv/bin/python scripts/run_answer_eval.py
[--qids a,b] [--out path]`.

Results files are run outputs (timestamps, latencies, prose), not
part of the fixed set; the fixed set is p13_answer_eval.json.
"""
import argparse
import asyncio
import json
import re
import sys
import time
from datetime import date

sys.path.insert(0, "/home/opticpulse/healthgraph")

from dotenv import load_dotenv

load_dotenv("/home/opticpulse/healthgraph/.env")

from langchain_core.messages import HumanMessage

from agents.orchestrator import workflow
from services.evaluation.checks import corpus_uuids, evaluate_run
from services.retrieval.day_range import resolve_window
from services.retrieval.router import resolve_comparison_windows

_EVAL_PATH = "/home/opticpulse/healthgraph/evals/p13_answer_eval.json"
_UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)


def resolve_expected_periods(spec: dict, today) -> list[dict]:
    """Runtime resolution of a question's window_spec (no hard-coding)."""
    window_spec = spec.get("window_spec") or {}
    if window_spec.get("none"):
        return []
    if "preset" in window_spec:
        start, end = resolve_window(window_spec["preset"], today)
        return [{"label": window_spec["preset"], "start": start, "end": end}]
    if "explicit" in window_spec:
        start, end = window_spec["explicit"]
        return [{"label": f"{start}:{end}", "start": start, "end": end}]
    if "comparison_text" in window_spec:
        resolved = resolve_comparison_windows(window_spec["comparison_text"], today)
        return (resolved or {}).get("periods", [])
    return []


async def run_one(spec: dict, today_str: str) -> dict:
    """Execute one question through the compiled workflow (live)."""
    app = workflow.compile()
    config = {
        "configurable": {"session_patient_id": spec["patient_id"]},
        "recursion_limit": 15,
    }
    record = {
        "qid": spec["qid"], "question": spec["question"],
        "patient": spec["patient"], "patient_id": spec["patient_id"],
        "run_date": today_str, "status": "LIVE",
    }
    t1 = time.time()
    try:
        result = await asyncio.wait_for(
            app.ainvoke({"messages": [HumanMessage(content=spec["question"])]},
                        config=config),
            timeout=240,
        )
    except Exception as e:  # provider/DB/runtime down -> BLOCKED, never mocked
        record.update({"status": "BLOCKED",
                       "error": f"{type(e).__name__}: {str(e)[:200]}",
                       "seconds": round(time.time() - t1, 1)})
        return record
    dt = round(time.time() - t1, 1)
    tool_calls, tool_texts = [], []
    for m in result.get("messages", []):
        for tc in getattr(m, "tool_calls", []) or []:
            tool_calls.append({"name": tc.get("name"), "args": tc.get("args") or {}})
        if type(m).__name__ == "ToolMessage":
            try:
                tool_texts.append(str(m.content))
            except Exception:
                continue
    final = result.get("final_output")
    if final is None:
        record.update({"status": "BLOCKED", "error": "no final_output",
                       "seconds": dt})
        return record
    citations = [c.model_dump() if hasattr(c, "model_dump") else dict(c)
                 for c in (final.citations or [])]
    answer = final.response_text or ""
    record.update({
        "response_text": answer, "citations": citations,
        "tool_calls": tool_calls,
        "tools_used": sorted({c["name"] for c in tool_calls}),
        "tool_texts": tool_texts,
        "citation_count": len(citations),
        "probe_uuids": sorted(set(_UUID_RE.findall(
            answer + "\n" + json.dumps(citations, default=str)))),
        "seconds": dt,
    })
    return record


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--qids", default="",
                        help="comma-separated qids (default: all)")
    parser.add_argument("--out", default="/tmp/opencode/p13_eval_results.json")
    args = parser.parse_args()

    specs = json.load(open(_EVAL_PATH))["questions"]
    only = {q.strip() for q in args.qids.split(",") if q.strip()}
    if only:
        specs = [s for s in specs if s["qid"] in only]
    today = date.today()
    today_str = today.isoformat()

    runs = []
    for spec in specs:
        print(f"RUNNING {spec['qid']}: {spec['question'][:60]}", flush=True)
        run = await run_one(spec, today_str)
        print(f"DONE {spec['qid']} status={run['status']} "
              f"tools={run.get('tools_used')} {run.get('seconds')}s "
              f"err={run.get('error')}", flush=True)
        runs.append(run)

    by_question = {}
    for run in runs:
        by_question.setdefault(run["question"], []).append(run)
    for run, spec in zip(runs, specs):
        if run["status"] != "LIVE":
            run["checks"] = {}
            continue
        spec = dict(spec)
        spec["expected_periods"] = resolve_expected_periods(spec, today)
        if spec.get("isolation_probe"):
            refs = [r for r in by_question.get(run["question"], [])
                    if r["qid"] != run["qid"] and r["status"] == "LIVE"]
            if refs:
                run["reference_corpus"] = refs[0].get("tool_texts", [])
        run["checks"] = evaluate_run(run, spec, today)
        failed = [k for k, v in run["checks"].items() if not v["passed"]]
        run["verdict"] = "PASS" if not failed else "FAIL"
        run["failed_checks"] = failed
        # Tool corpora are large; keep ids for audit, drop raw texts.
        run["tool_corpus_uuid_count"] = len(corpus_uuids(run.get("tool_texts")))
        del run["tool_texts"]

    passed = sum(1 for r in runs if r.get("verdict") == "PASS")
    live = sum(1 for r in runs if r.get("status") == "LIVE")
    print(f"LIVE {live}/{len(runs)}  PASS {passed}/{live}")
    json.dump({"run_date": today_str, "runs": runs},
              open(args.out, "w"), indent=1, default=str)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
