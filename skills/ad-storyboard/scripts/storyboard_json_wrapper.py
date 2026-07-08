#!/usr/bin/env python3
"""Build strict storyboard tasks and normalize JSON responses."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from normalize_storyboard_contract import ContractError, normalize_contract


SCHEMA_REQUIREMENTS = """Return JSON only. Do not include Markdown.
The root object must contain:
- intake
- selected_pattern
- reference_evidence_summary with global_award_logic and korean_style_logic
- storyboard: exactly 6 beat objects
- cta
- assumptions
- required_inputs
- quality_gates
- reference_distance_summary

Each storyboard beat must include:
- beat
- timecode
- frame_anchor
- story_function
- visual_composition
- character_direction
- product_cue object
- delight_cue object
- image_prompt_block object with subject, context, composition, lighting, mood, negative
- video_prompt_block object with subject_motion, camera_motion, continuity, duration_sec
- edit_decision object with cut_in, cut_out, rhythm, why_this_shot_next
- risk_note

Do not write image_prompt_block, video_prompt_block, or edit_decision as a string.
required_inputs must be [] unless there is a true blocker.
Do not choose proof_experiment without proof assets, comparison, metric, expert evidence, test, substantiated ingredient story, or claim-risk need.
Do not copy any source ad, actor, line, costume, thumbnail, layout, prop arrangement, logo, scene composition, art direction, or frame.
"""


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"Cannot read JSON from {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ContractError("Brief JSON must be an object")
    return data


def write_text(path: Path | None, text: str) -> None:
    if path:
        path.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)


def build_task(brief: dict[str, Any]) -> str:
    brief_text = json.dumps(brief, ensure_ascii=False, indent=2)
    return (
        "Generate a complete original advertising storyboard contract from this brief.\n\n"
        f"Brief JSON:\n{brief_text}\n\n"
        f"{SCHEMA_REQUIREMENTS}"
    )


def extract_json(text: str) -> dict[str, Any]:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    candidates = []
    if fenced:
        candidates.append(fenced.group(1))
    candidates.append(text.strip())

    raw = text
    first = raw.find("{")
    last = raw.rfind("}")
    if first != -1 and last != -1 and last > first:
        candidates.append(raw[first : last + 1])

    errors: list[str] = []
    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError as exc:
            errors.append(str(exc))
            continue
        if isinstance(data, dict):
            return data
        errors.append("decoded JSON was not an object")
    raise ContractError("No valid JSON object found in response: " + "; ".join(errors[-3:]))


def cmd_build_task(args: argparse.Namespace) -> int:
    brief = read_json(args.brief)
    write_text(args.output, build_task(brief))
    return 0


def cmd_normalize_response(args: argparse.Namespace) -> int:
    try:
        response = args.response.read_text(encoding="utf-8-sig")
        data = extract_json(response)
        normalized = normalize_contract(data)
    except (OSError, ContractError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    write_text(args.output, json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    try:
        normalized = normalize_contract(read_json(args.contract))
    except ContractError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    write_text(args.output, json.dumps(normalized, ensure_ascii=False, indent=2) + "\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Strict JSON wrapper for ad storyboard contracts.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build-task", help="Create a strict OpenCrab task from a brief JSON file.")
    build.add_argument("brief", type=Path)
    build.add_argument("--output", "-o", type=Path)
    build.set_defaults(func=cmd_build_task)

    normalize = subparsers.add_parser("normalize-response", help="Extract and normalize JSON from a model response.")
    normalize.add_argument("response", type=Path)
    normalize.add_argument("--output", "-o", type=Path)
    normalize.set_defaults(func=cmd_normalize_response)

    validate = subparsers.add_parser("validate", help="Validate and normalize a contract JSON file.")
    validate.add_argument("contract", type=Path)
    validate.add_argument("--output", "-o", type=Path)
    validate.set_defaults(func=cmd_validate)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
