#!/usr/bin/env python3
"""Validate and normalize an ad storyboard contract JSON file."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


BEATS = [
    ("hook", "0-3s", 3),
    ("tension", "3-7s", 4),
    ("product_reveal", "7-12s", 5),
    ("demo_proof", "12-20s", 8),
    ("joy_payoff", "20-26s", 6),
    ("cta_memory_frame", "26-30s", 4),
]

NEGATIVE = (
    "no source asset, actor, line, frame, logo, costume, layout, art-direction, "
    "celebrity, thumbnail, Korean reference scene, or frame clone copying"
)


class ContractError(ValueError):
    pass


def as_dict(value: Any, field: str) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        return {"subject": value.strip()} if field == "image_prompt_block" else {}
    if value in (None, ""):
        return {}
    raise ContractError(f"{field} must be an object, not {type(value).__name__}")


def ensure_str(data: dict[str, Any], key: str, default: str = "") -> None:
    value = data.get(key, default)
    if value is None:
        value = default
    if not isinstance(value, str):
        value = str(value)
    data[key] = value


def normalize_prompt_blocks(beat: dict[str, Any], default_duration: int) -> None:
    image = as_dict(beat.get("image_prompt_block"), "image_prompt_block")
    for key in ["subject", "context", "composition", "lighting", "mood"]:
        ensure_str(image, key)
    image["negative"] = image.get("negative") or NEGATIVE
    beat["image_prompt_block"] = image

    video = as_dict(beat.get("video_prompt_block"), "video_prompt_block")
    for key in ["subject_motion", "camera_motion", "continuity"]:
        ensure_str(video, key)
    try:
        video["duration_sec"] = int(video.get("duration_sec", default_duration))
    except (TypeError, ValueError):
        video["duration_sec"] = default_duration
    beat["video_prompt_block"] = video

    edit = as_dict(beat.get("edit_decision"), "edit_decision")
    for key in ["cut_in", "cut_out", "rhythm", "why_this_shot_next"]:
        ensure_str(edit, key)
    beat["edit_decision"] = edit


def normalize_contract(contract: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(contract, dict):
        raise ContractError("Contract root must be a JSON object")

    contract.setdefault("intake", {})
    contract.setdefault("selected_pattern", {})
    contract.setdefault("reference_evidence_summary", {})
    contract.setdefault("cta", {"wording": "", "visual_treatment": "", "single_action": True})
    contract.setdefault("assumptions", [])
    contract.setdefault("required_inputs", [])
    contract.setdefault("quality_gates", {})
    contract.setdefault("reference_distance_summary", "")

    storyboard = contract.get("storyboard")
    if not isinstance(storyboard, list):
        raise ContractError("storyboard must be a list")
    if len(storyboard) != 6:
        raise ContractError(f"storyboard must contain exactly 6 beats, found {len(storyboard)}")

    for index, beat in enumerate(storyboard):
        if not isinstance(beat, dict):
            raise ContractError(f"storyboard[{index}] must be an object")
        default_beat, default_timecode, default_duration = BEATS[index]
        beat.setdefault("beat", default_beat)
        beat.setdefault("timecode", default_timecode)
        for key in [
            "frame_anchor",
            "story_function",
            "visual_composition",
            "character_direction",
            "risk_note",
        ]:
            ensure_str(beat, key)
        beat.setdefault("product_cue", {"visible": False, "cue_type": "", "role": "", "prominence": ""})
        beat.setdefault("delight_cue", {"mechanism": "", "linked_to_product": True, "why_product_matters": ""})
        normalize_prompt_blocks(beat, default_duration)

    if not isinstance(contract["required_inputs"], list):
        raise ContractError("required_inputs must be a list")
    if not isinstance(contract["assumptions"], list):
        contract["assumptions"] = [str(contract["assumptions"])]

    return contract


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and normalize an ad storyboard contract JSON file.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", "-o", type=Path)
    args = parser.parse_args()

    try:
        contract = json.loads(args.input.read_text(encoding="utf-8-sig"))
        normalized = normalize_contract(contract)
    except (OSError, json.JSONDecodeError, ContractError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    text = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
