#!/usr/bin/env python3
"""Create and validate fingerprints for Claude Design feature manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any


SIGNATURE_FIELDS = (
    "visible_presentation",
    "precondition",
    "trigger",
    "target_identity",
    "target_cardinality",
    "timing",
    "effect_on_active_work",
    "collection_mutation",
    "expected_result",
    "next_state",
)
MOCKUP_EVIDENCE_KINDS = {"rendered", "interaction_code", "annotation", "user_answer"}
CLASSIFICATION_EVIDENCE_KINDS = {"implementation", "epic"}
HEX_DIGITS = set("0123456789abcdef")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_source(root: Path, raw_path: str) -> Path:
    root = root.resolve()
    relative = Path(raw_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"source path must be relative to --root: {raw_path}")
    resolved = (root / relative).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError(f"source path escapes --root: {raw_path}") from error
    if not resolved.is_file():
        raise ValueError(f"source file does not exist: {raw_path}")
    return resolved


def source_records(root: Path, paths: list[str]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for raw_path in sorted(set(paths)):
        path = resolve_source(root, raw_path)
        records.append({"path": raw_path, "sha256": sha256_file(path)})
    if not records:
        raise ValueError("at least one source file is required")
    return records


def combined_fingerprint(records: list[dict[str, str]]) -> str:
    digest = hashlib.sha256()
    for record in sorted(records, key=lambda item: item["path"]):
        digest.update(record["path"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(record["sha256"].encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and set(value) <= HEX_DIGITS
    )


def validate_mockup_evidence(
    value: Any,
    location: str,
    source_paths: set[str],
    errors: list[str],
) -> None:
    if not isinstance(value, list):
        errors.append(f"{location} must be a list")
        return
    for index, item in enumerate(value):
        item_location = f"{location}[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_location} must be an object")
            continue
        if item.get("kind") not in MOCKUP_EVIDENCE_KINDS:
            errors.append(f"{item_location}.kind must be a direct mockup or user evidence type")
        for key in ("source", "detail"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                errors.append(f"{item_location}.{key} must be a non-empty string")
        evidence_source = item.get("source")
        if not isinstance(evidence_source, str):
            continue
        if item.get("kind") == "user_answer":
            if not evidence_source.startswith("user_answer:"):
                errors.append(f"{item_location}.source must start with user_answer:")
        elif not any(
            evidence_source == path
            or evidence_source.startswith(f"{path}#")
            for path in source_paths
        ):
            errors.append(f"{item_location}.source must cite a recorded mockup source")


def validate_classification_evidence(
    value: Any,
    location: str,
    comparison_sources: dict[str, str],
    errors: list[str],
) -> None:
    if not isinstance(value, list):
        errors.append(f"{location} must be a list")
        return
    if not value:
        errors.append(f"{location} must contain implementation and Epic evidence")
        return
    cited_kinds: set[str] = set()
    for index, item in enumerate(value):
        item_location = f"{location}[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_location} must be an object")
            continue
        kind = item.get("kind")
        if kind not in CLASSIFICATION_EVIDENCE_KINDS:
            errors.append(f"{item_location}.kind must be implementation or epic")
        for key in ("source", "detail"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                errors.append(f"{item_location}.{key} must be a non-empty string")
        evidence_source = item.get("source")
        if not isinstance(evidence_source, str):
            continue
        matched_path = next(
            (
                path
                for path in comparison_sources
                if evidence_source == path or evidence_source.startswith(f"{path}#")
            ),
            None,
        )
        if matched_path is None:
            errors.append(f"{item_location}.source must cite a recorded comparison source")
        elif kind != comparison_sources[matched_path]:
            errors.append(f"{item_location}.kind must match its recorded comparison source")
        elif isinstance(kind, str):
            cited_kinds.add(kind)
    missing_kinds = CLASSIFICATION_EVIDENCE_KINDS - cited_kinds
    if missing_kinds:
        errors.append(
            f"{location} must include both implementation and epic evidence; missing: "
            f"{', '.join(sorted(missing_kinds))}"
        )


def validate_manifest_data(
    data: Any,
    root: Path,
    expected_target: str | None = None,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["manifest must be a JSON object"]

    if data.get("schema_version") != 3:
        errors.append("schema_version must be 3")
    if not isinstance(data.get("target"), str) or not data["target"].strip():
        errors.append("target must be a non-empty string")
    elif expected_target is not None and data["target"] != expected_target:
        errors.append(f"target must be {expected_target}")
    if data.get("scope_policy") != "ALL_VISIBLE_PRODUCT_FEATURES_ARE_CURRENT":
        errors.append("scope_policy must be ALL_VISIBLE_PRODUCT_FEATURES_ARE_CURRENT")
    if data.get("comparison_policy") != "MOCKUP_VS_CURRENT_PRODUCT_AND_COMPLETED_EPICS":
        errors.append(
            "comparison_policy must be MOCKUP_VS_CURRENT_PRODUCT_AND_COMPLETED_EPICS"
        )

    change_boundary = data.get("change_boundary")
    if not isinstance(change_boundary, dict):
        errors.append("change_boundary must be an object")
    elif not isinstance(change_boundary.get("description"), str) or not change_boundary["description"].strip():
        errors.append("change_boundary.description must be a non-empty string")

    sources = data.get("sources")
    current_records: list[dict[str, str]] = []
    source_paths: set[str] = set()
    if not isinstance(sources, list) or not sources:
        errors.append("sources must be a non-empty list")
    else:
        for index, source in enumerate(sources):
            location = f"sources[{index}]"
            if not isinstance(source, dict):
                errors.append(f"{location} must be an object")
                continue
            path = source.get("path")
            expected_hash = source.get("sha256")
            if not isinstance(path, str) or not path:
                errors.append(f"{location}.path must be a non-empty string")
                continue
            if path in source_paths:
                errors.append(f"{location}.path is duplicated: {path}")
                continue
            source_paths.add(path)
            if not is_sha256(expected_hash):
                errors.append(f"{location}.sha256 must be 64 lowercase hex characters")
                continue
            try:
                actual_hash = sha256_file(resolve_source(root, path))
            except ValueError as error:
                errors.append(str(error))
                continue
            current_records.append({"path": path, "sha256": actual_hash})
            if actual_hash != expected_hash:
                errors.append(f"source changed after extraction: {path}")

    expected_fingerprint = data.get("source_fingerprint")
    if not is_sha256(expected_fingerprint):
        errors.append("source_fingerprint must be 64 lowercase hex characters")
    elif len(current_records) == len(source_paths):
        actual_fingerprint = combined_fingerprint(current_records)
        if actual_fingerprint != expected_fingerprint:
            errors.append("source_fingerprint does not match the current sources")

    source_reviews = data.get("source_reviews")
    reviewed_files: set[str] = set()
    mockup_files = {path for path in source_paths if path.endswith(".dc.html")}
    if not isinstance(source_reviews, list) or not source_reviews:
        errors.append("source_reviews must be a non-empty list")
    else:
        for index, review in enumerate(source_reviews):
            location = f"source_reviews[{index}]"
            if not isinstance(review, dict):
                errors.append(f"{location} must be an object")
                continue
            mockup_file = review.get("mockup_file")
            if mockup_file not in mockup_files:
                errors.append(f"{location}.mockup_file must name a recorded .dc.html source")
            elif mockup_file in reviewed_files:
                errors.append(f"{location}.mockup_file is duplicated: {mockup_file}")
            else:
                reviewed_files.add(mockup_file)
            rendered_states = review.get("rendered_states")
            if (
                not isinstance(rendered_states, list)
                or not rendered_states
                or any(not isinstance(state, str) or not state.strip() for state in rendered_states)
            ):
                errors.append(f"{location}.rendered_states must contain every reviewed state")
            if review.get("interaction_code_reviewed") is not True:
                errors.append(f"{location}.interaction_code_reviewed must be true")
    if reviewed_files != mockup_files:
        missing_reviews = sorted(mockup_files - reviewed_files)
        if missing_reviews:
            errors.append(f"source_reviews is missing: {', '.join(missing_reviews)}")

    comparison_sources = data.get("comparison_sources")
    comparison_source_kinds: dict[str, str] = {}
    if not isinstance(comparison_sources, list) or not comparison_sources:
        errors.append("comparison_sources must be a non-empty list")
    else:
        for index, source in enumerate(comparison_sources):
            location = f"comparison_sources[{index}]"
            if not isinstance(source, dict):
                errors.append(f"{location} must be an object")
                continue
            kind = source.get("kind")
            path = source.get("path")
            expected_hash = source.get("sha256")
            if kind not in CLASSIFICATION_EVIDENCE_KINDS:
                errors.append(f"{location}.kind must be implementation or epic")
            if not isinstance(path, str) or not path:
                errors.append(f"{location}.path must be a non-empty string")
                continue
            if path in comparison_source_kinds:
                errors.append(f"{location}.path is duplicated: {path}")
                continue
            if isinstance(kind, str):
                comparison_source_kinds[path] = kind
            if not is_sha256(expected_hash):
                errors.append(f"{location}.sha256 must be 64 lowercase hex characters")
                continue
            try:
                actual_hash = sha256_file(resolve_source(root, path))
            except ValueError as error:
                errors.append(str(error))
                continue
            if actual_hash != expected_hash:
                errors.append(f"comparison source changed after extraction: {path}")
    missing_comparison_kinds = (
        CLASSIFICATION_EVIDENCE_KINDS - set(comparison_source_kinds.values())
    )
    if missing_comparison_kinds:
        errors.append(
            "comparison_sources must include implementation and epic sources; missing: "
            f"{', '.join(sorted(missing_comparison_kinds))}"
        )

    if isinstance(change_boundary, dict):
        validate_classification_evidence(
            change_boundary.get("evidence"),
            "change_boundary.evidence",
            comparison_source_kinds,
            errors,
        )

    mockup_inventory = data.get("mockup_inventory")
    inventory_ids: set[str] = set()
    if not isinstance(mockup_inventory, list) or not mockup_inventory:
        errors.append("mockup_inventory must be a non-empty list")
    else:
        for index, item in enumerate(mockup_inventory):
            location = f"mockup_inventory[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{location} must be an object")
                continue
            inventory_id = item.get("id")
            if not isinstance(inventory_id, str) or not inventory_id.strip():
                errors.append(f"{location}.id must be a non-empty string")
            elif inventory_id in inventory_ids:
                errors.append(f"{location}.id is duplicated: {inventory_id}")
            else:
                inventory_ids.add(inventory_id)
            if item.get("mockup_file") not in mockup_files:
                errors.append(f"{location}.mockup_file must name a recorded .dc.html source")
            for key in ("rendered_state", "control_or_state"):
                if not isinstance(item.get(key), str) or not item[key].strip():
                    errors.append(f"{location}.{key} must be a non-empty string")
            visible_evidence = item.get("visible_evidence")
            validate_mockup_evidence(
                visible_evidence,
                f"{location}.visible_evidence",
                source_paths,
                errors,
            )
            if isinstance(visible_evidence, list) and not visible_evidence:
                errors.append(f"{location}.visible_evidence must contain direct evidence")

    features = data.get("features")
    feature_ids: set[str] = set()
    feature_signatures: dict[str, dict[str, Any]] = {}
    action_members: dict[str, list[str]] = {}
    classified_inventory_ids: dict[str, str] = {}
    if not isinstance(features, list):
        errors.append("features must be a list")
    else:
        for index, feature in enumerate(features):
            location = f"features[{index}]"
            if not isinstance(feature, dict):
                errors.append(f"{location} must be an object")
                continue
            feature_id = feature.get("id")
            if not isinstance(feature_id, str) or not feature_id.strip():
                errors.append(f"{location}.id must be a non-empty string")
            elif feature_id in feature_ids:
                errors.append(f"{location}.id is duplicated: {feature_id}")
            else:
                feature_ids.add(feature_id)
            for key in ("rendered_state", "control_or_state"):
                if not isinstance(feature.get(key), str) or not feature[key].strip():
                    errors.append(f"{location}.{key} must be a non-empty string")
            if feature.get("mockup_file") not in mockup_files:
                errors.append(f"{location}.mockup_file must name a recorded .dc.html source")
            if feature.get("scope") != "CURRENT":
                errors.append(f"{location}.scope must be CURRENT")
            if feature.get("coverage_role") != "CHANGE_FEATURE":
                errors.append(f"{location}.coverage_role must be CHANGE_FEATURE")
            feature_inventory_ids = feature.get("inventory_ids")
            if not isinstance(feature_inventory_ids, list) or not feature_inventory_ids:
                errors.append(f"{location}.inventory_ids must be a non-empty list")
            else:
                if any(not isinstance(item, str) for item in feature_inventory_ids):
                    errors.append(f"{location}.inventory_ids must contain only strings")
                elif len(set(feature_inventory_ids)) != len(feature_inventory_ids):
                    errors.append(f"{location}.inventory_ids must not contain duplicates")
                for inventory_id in feature_inventory_ids:
                    if not isinstance(inventory_id, str) or inventory_id not in inventory_ids:
                        errors.append(f"{location}.inventory_ids contains an unknown inventory ID")
                    elif inventory_id in classified_inventory_ids:
                        errors.append(
                            f"{location}.inventory_ids reclassifies {inventory_id} from "
                            f"{classified_inventory_ids[inventory_id]}"
                        )
                    else:
                        classified_inventory_ids[inventory_id] = location
            validate_classification_evidence(
                feature.get("classification_evidence"),
                f"{location}.classification_evidence",
                comparison_source_kinds,
                errors,
            )
            action_key = feature.get("action_key")
            if "action_key" not in feature or not (
                action_key is None
                or isinstance(action_key, str) and action_key.strip()
            ):
                errors.append(f"{location}.action_key must be null or a non-empty string")
            elif isinstance(action_key, str) and isinstance(feature_id, str):
                action_members.setdefault(action_key, []).append(feature_id)

            signature = feature.get("signature")
            unknown_fields: list[str] = []
            if not isinstance(signature, dict):
                errors.append(f"{location}.signature must be an object")
            else:
                if isinstance(feature_id, str):
                    feature_signatures[feature_id] = signature
                for field_name in SIGNATURE_FIELDS:
                    field_location = f"{location}.signature.{field_name}"
                    field = signature.get(field_name)
                    if not isinstance(field, dict):
                        errors.append(f"{field_location} must be an object")
                        continue
                    field_value = field.get("value")
                    evidence = field.get("evidence")
                    if not isinstance(field_value, str) or not field_value.strip():
                        errors.append(f"{field_location}.value must be a non-empty string")
                    elif field_value == "UNKNOWN":
                        unknown_fields.append(field_name)
                        if evidence != []:
                            errors.append(f"{field_location}.evidence must be empty for UNKNOWN")
                    else:
                        validate_mockup_evidence(
                            evidence,
                            f"{field_location}.evidence",
                            source_paths,
                            errors,
                        )
                        if isinstance(evidence, list) and not evidence:
                            errors.append(f"{field_location}.evidence must contain direct evidence")

            status = feature.get("status")
            question = feature.get("open_question")
            if unknown_fields:
                if status != "UNCLEAR":
                    errors.append(f"{location}.status must be UNCLEAR when a field is UNKNOWN")
                if not isinstance(question, str) or not question.strip():
                    errors.append(f"{location}.open_question must ask one focused question")
                errors.append(f"{location} is unresolved and requires a user answer")
            else:
                if status != "PROVEN":
                    errors.append(f"{location}.status must be PROVEN when all fields have evidence")
                if question not in (None, ""):
                    errors.append(f"{location}.open_question must be null when status is PROVEN")

    unchanged_context = data.get("unchanged_context")
    context_ids: set[str] = set()
    if not isinstance(unchanged_context, list):
        errors.append("unchanged_context must be a list")
    else:
        for index, item in enumerate(unchanged_context):
            location = f"unchanged_context[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{location} must be an object")
                continue
            context_id = item.get("id")
            if not isinstance(context_id, str) or not context_id.strip():
                errors.append(f"{location}.id must be a non-empty string")
            elif context_id in context_ids or context_id in feature_ids:
                errors.append(f"{location}.id is duplicated: {context_id}")
            else:
                context_ids.add(context_id)
            for key in ("rendered_state", "control_or_state", "reason"):
                if not isinstance(item.get(key), str) or not item[key].strip():
                    errors.append(f"{location}.{key} must be a non-empty string")
            if item.get("mockup_file") not in mockup_files:
                errors.append(f"{location}.mockup_file must name a recorded .dc.html source")
            if item.get("scope") != "CURRENT":
                errors.append(f"{location}.scope must be CURRENT")
            if item.get("coverage_role") != "UNCHANGED_CONTEXT":
                errors.append(f"{location}.coverage_role must be UNCHANGED_CONTEXT")
            context_inventory_ids = item.get("inventory_ids")
            if not isinstance(context_inventory_ids, list) or not context_inventory_ids:
                errors.append(f"{location}.inventory_ids must be a non-empty list")
            else:
                if any(not isinstance(value, str) for value in context_inventory_ids):
                    errors.append(f"{location}.inventory_ids must contain only strings")
                elif len(set(context_inventory_ids)) != len(context_inventory_ids):
                    errors.append(f"{location}.inventory_ids must not contain duplicates")
                for inventory_id in context_inventory_ids:
                    if not isinstance(inventory_id, str) or inventory_id not in inventory_ids:
                        errors.append(f"{location}.inventory_ids contains an unknown inventory ID")
                    elif inventory_id in classified_inventory_ids:
                        errors.append(
                            f"{location}.inventory_ids reclassifies {inventory_id} from "
                            f"{classified_inventory_ids[inventory_id]}"
                        )
                    else:
                        classified_inventory_ids[inventory_id] = location
            validate_classification_evidence(
                item.get("classification_evidence"),
                f"{location}.classification_evidence",
                comparison_source_kinds,
                errors,
            )

    unclassified_inventory_ids = inventory_ids - set(classified_inventory_ids)
    if unclassified_inventory_ids:
        errors.append(
            "mockup_inventory has unclassified IDs: "
            f"{', '.join(sorted(unclassified_inventory_ids))}"
        )

    groups = data.get("action_identity_groups")
    grouped_action_keys: set[str] = set()
    if not isinstance(groups, list):
        errors.append("action_identity_groups must be a list")
    else:
        for index, group in enumerate(groups):
            location = f"action_identity_groups[{index}]"
            if not isinstance(group, dict):
                errors.append(f"{location} must be an object")
                continue
            action_key = group.get("label_or_intent")
            if not isinstance(action_key, str) or not action_key.strip():
                errors.append(f"{location}.label_or_intent must be a non-empty string")
                action_key = ""
            elif action_key in grouped_action_keys:
                errors.append(f"{location}.label_or_intent is duplicated: {action_key}")
            else:
                grouped_action_keys.add(action_key)
            ids = group.get("feature_ids")
            if not isinstance(ids, list) or len(ids) < 2:
                errors.append(f"{location}.feature_ids must contain at least two feature IDs")
            elif any(not isinstance(feature_id, str) or feature_id not in feature_ids for feature_id in ids):
                errors.append(f"{location}.feature_ids contains an unknown feature ID")
            elif len(set(ids)) != len(ids):
                errors.append(f"{location}.feature_ids must not contain duplicates")
            elif set(ids) != set(action_members.get(action_key, [])):
                errors.append(f"{location}.feature_ids must contain every feature with this action key")
            outcome = group.get("outcome")
            question = group.get("open_question")
            if outcome not in {"SAME_ACTION", "DISTINCT", "CONFLICT", "UNCLEAR"}:
                errors.append(
                    f"{location}.outcome must be SAME_ACTION, DISTINCT, CONFLICT, or UNCLEAR"
                )

            compared_ids = ids if isinstance(ids, list) else []
            actual_differences = {
                field_name
                for field_name in SIGNATURE_FIELDS
                if len({
                    repr(feature_signatures.get(feature_id, {}).get(field_name, {}).get("value"))
                    for feature_id in compared_ids
                    if isinstance(feature_id, str)
                }) > 1
            }
            differences = group.get("differences")
            recorded_differences: set[str] = set()
            if not isinstance(differences, list):
                errors.append(f"{location}.differences must be a list")
            else:
                for difference_index, difference in enumerate(differences):
                    difference_location = f"{location}.differences[{difference_index}]"
                    if not isinstance(difference, dict):
                        errors.append(f"{difference_location} must be an object")
                        continue
                    field_name = difference.get("field")
                    if field_name not in SIGNATURE_FIELDS:
                        errors.append(f"{difference_location}.field is not a behavior field")
                        continue
                    recorded_differences.add(field_name)
                    values = difference.get("values")
                    expected_values = {
                        feature_id: feature_signatures.get(feature_id, {}).get(field_name, {}).get("value")
                        for feature_id in compared_ids
                        if isinstance(feature_id, str)
                    }
                    if values != expected_values:
                        errors.append(f"{difference_location}.values must match the feature signatures")
                    validate_mockup_evidence(
                        difference.get("evidence"),
                        f"{difference_location}.evidence",
                        source_paths,
                        errors,
                    )
                    if (
                        outcome in {"DISTINCT", "CONFLICT"}
                        and isinstance(difference.get("evidence"), list)
                        and not difference["evidence"]
                    ):
                        errors.append(f"{difference_location}.evidence must prove the difference")
            if recorded_differences != actual_differences:
                errors.append(f"{location}.differences must list every differing behavior field")

            decision_evidence = group.get("decision_evidence")
            validate_mockup_evidence(
                decision_evidence,
                f"{location}.decision_evidence",
                source_paths,
                errors,
            )
            if outcome == "SAME_ACTION" and actual_differences:
                errors.append(f"{location}.outcome cannot be SAME_ACTION when signatures differ")
            if outcome in {"DISTINCT", "CONFLICT"} and not actual_differences:
                errors.append(f"{location}.outcome requires at least one behavior difference")
            has_unknown = any(
                feature_signatures.get(feature_id, {}).get(field_name, {}).get("value") == "UNKNOWN"
                for feature_id in compared_ids
                if isinstance(feature_id, str)
                for field_name in SIGNATURE_FIELDS
            )
            if has_unknown and outcome != "UNCLEAR":
                errors.append(f"{location}.outcome must be UNCLEAR while a behavior field is UNKNOWN")
            if outcome in {"DISTINCT", "CONFLICT"} and isinstance(decision_evidence, list) and not decision_evidence:
                errors.append(f"{location}.decision_evidence must prove the outcome")
            if outcome == "UNCLEAR":
                if not isinstance(question, str) or not question.strip():
                    errors.append(f"{location}.open_question must ask one focused question")
                errors.append(f"{location} is unresolved and requires a user answer")
            else:
                if question not in (None, ""):
                    errors.append(f"{location}.open_question must be null unless the outcome is UNCLEAR")

    required_action_keys = {
        action_key
        for action_key, members in action_members.items()
        if len(members) > 1
    }
    if grouped_action_keys != required_action_keys:
        missing_groups = sorted(required_action_keys - grouped_action_keys)
        extra_groups = sorted(grouped_action_keys - required_action_keys)
        if missing_groups:
            errors.append(f"action_identity_groups is missing: {', '.join(missing_groups)}")
        if extra_groups:
            errors.append(f"action_identity_groups has non-duplicate action keys: {', '.join(extra_groups)}")

    return errors


def fingerprint_command(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    records = source_records(root, args.sources)
    print(json.dumps({
        "sources": records,
        "source_fingerprint": combined_fingerprint(records),
    }, indent=2))
    return 0


def validate_command(args: argparse.Namespace) -> int:
    root = Path(args.root).resolve()
    with Path(args.manifest).open(encoding="utf-8") as source:
        data = json.load(source)
    errors = validate_manifest_data(data, root, args.expected_target)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("Manifest is valid and source hashes are current.")
    return 0


def self_test() -> int:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        mockup = root / "mock.dc.html"
        implementation = root / "current-product.tsx"
        epic = root / "completed-epic.md"
        mockup.write_text("<button>Send now</button>", encoding="utf-8")
        implementation.write_text("export const queue = ['Graph'];", encoding="utf-8")
        epic.write_text("# Completed Epic\n\nGraph navigation exists.\n", encoding="utf-8")
        records = source_records(root, ["mock.dc.html"])
        comparison_sources = [
            {
                "kind": "implementation",
                "path": "current-product.tsx",
                "sha256": sha256_file(implementation),
            },
            {
                "kind": "epic",
                "path": "completed-epic.md",
                "sha256": sha256_file(epic),
            },
        ]

        def direct_evidence() -> list[dict[str, str]]:
            return [{
                "kind": "rendered",
                "source": "mock.dc.html#state=generating button=Send now",
                "detail": "The rendered row shows the control.",
            }]

        classification_evidence = [
            {
                "kind": "implementation",
                "source": "current-product.tsx#queue",
                "detail": "The current product does not include per-item Send now.",
            },
            {
                "kind": "epic",
                "source": "completed-epic.md#completed-epic",
                "detail": "The completed Epic does not specify per-item Send now.",
            },
        ]
        manifest = {
            "schema_version": 3,
            "target": "self-test",
            "scope_policy": "ALL_VISIBLE_PRODUCT_FEATURES_ARE_CURRENT",
            "comparison_policy": "MOCKUP_VS_CURRENT_PRODUCT_AND_COMPLETED_EPICS",
            "change_boundary": {
                "description": "Queue controls changed by the approved mockup.",
                "evidence": classification_evidence,
            },
            "sources": records,
            "source_fingerprint": combined_fingerprint(records),
            "source_reviews": [{
                "mockup_file": "mock.dc.html",
                "rendered_states": ["generating"],
                "interaction_code_reviewed": True,
            }],
            "comparison_sources": comparison_sources,
            "mockup_inventory": [
                {
                    "id": "I001",
                    "mockup_file": "mock.dc.html",
                    "rendered_state": "generating",
                    "control_or_state": "Send now",
                    "visible_evidence": direct_evidence(),
                },
                {
                    "id": "I002",
                    "mockup_file": "mock.dc.html",
                    "rendered_state": "shell",
                    "control_or_state": "Graph",
                    "visible_evidence": direct_evidence(),
                },
            ],
            "features": [{
                "id": "M001",
                "mockup_file": "mock.dc.html",
                "rendered_state": "generating",
                "control_or_state": "Send now",
                "inventory_ids": ["I001"],
                "action_key": "send-now",
                "scope": "CURRENT",
                "coverage_role": "CHANGE_FEATURE",
                "classification_evidence": classification_evidence,
                "status": "PROVEN",
                "open_question": None,
                "signature": {
                    field_name: {"value": "proved value", "evidence": direct_evidence()}
                    for field_name in SIGNATURE_FIELDS
                },
            }],
            "unchanged_context": [{
                "id": "C001",
                "mockup_file": "mock.dc.html",
                "rendered_state": "shell",
                "control_or_state": "Graph",
                "inventory_ids": ["I002"],
                "scope": "CURRENT",
                "coverage_role": "UNCHANGED_CONTEXT",
                "reason": "The current product and completed Epic already contain Graph.",
                "classification_evidence": [
                    {
                        "kind": "implementation",
                        "source": "current-product.tsx#Graph",
                        "detail": "The current product exposes Graph.",
                    },
                    {
                        "kind": "epic",
                        "source": "completed-epic.md#completed-epic",
                        "detail": "The completed Epic specifies Graph navigation.",
                    },
                ],
            }],
            "action_identity_groups": [],
        }
        assert validate_manifest_data(manifest, root) == []
        assert any(
            "target must be another-target" in error
            for error in validate_manifest_data(manifest, root, "another-target")
        )
        manifest["features"][0]["signature"]["timing"]["evidence"][0]["source"] = (
            "docs/prd.md#timing"
        )
        assert any(
            "must cite a recorded mockup source" in error
            for error in validate_manifest_data(manifest, root)
        )
        manifest["features"][0]["signature"]["timing"]["evidence"][0]["source"] = (
            "mock.dc.html#state=generating button=Send now"
        )
        invalid_classification = json.loads(json.dumps(manifest))
        invalid_classification["features"][0]["classification_evidence"][0] = {
            "kind": "rendered",
            "source": "mock.dc.html#state=generating button=Send now",
            "detail": "Mockup evidence cannot classify baseline behavior.",
        }
        assert any(
            "kind must be implementation or epic" in error
            for error in validate_manifest_data(invalid_classification, root)
        )
        unclassified = json.loads(json.dumps(manifest))
        unclassified["unchanged_context"] = []
        assert any(
            "mockup_inventory has unclassified IDs: I002" in error
            for error in validate_manifest_data(unclassified, root)
        )
        manifest["mockup_inventory"].append({
            "id": "I003",
            "mockup_file": "mock.dc.html",
            "rendered_state": "generating alternate",
            "control_or_state": "Send now alternate",
            "visible_evidence": direct_evidence(),
        })
        duplicate = json.loads(json.dumps(manifest["features"][0]))
        duplicate["id"] = "M002"
        duplicate["inventory_ids"] = ["I003"]
        manifest["features"].append(duplicate)
        assert any(
            "action_identity_groups is missing" in error
            for error in validate_manifest_data(manifest, root)
        )
        manifest["action_identity_groups"] = [{
            "label_or_intent": "send-now",
            "feature_ids": ["M001", "M002"],
            "outcome": "SAME_ACTION",
            "differences": [],
            "decision_evidence": [],
            "open_question": None,
        }]
        assert validate_manifest_data(manifest, root) == []
        manifest["features"][1]["signature"]["timing"]["value"] = "different value"
        assert any(
            "outcome cannot be SAME_ACTION" in error
            for error in validate_manifest_data(manifest, root)
        )
        manifest["action_identity_groups"][0].update({
            "outcome": "DISTINCT",
            "differences": [{
                "field": "timing",
                "values": {"M001": "proved value", "M002": "different value"},
                "evidence": direct_evidence(),
            }],
            "decision_evidence": direct_evidence(),
        })
        assert validate_manifest_data(manifest, root) == []
        manifest["unchanged_context"][0]["classification_evidence"][0]["source"] = (
            "mock.dc.html#Graph"
        )
        assert any(
            "must cite a recorded comparison source" in error
            for error in validate_manifest_data(manifest, root)
        )
        manifest["unchanged_context"][0]["classification_evidence"][0]["source"] = (
            "current-product.tsx#Graph"
        )
        assert validate_manifest_data(manifest, root) == []
        manifest["features"][0]["signature"]["timing"] = {
            "value": "UNKNOWN",
            "evidence": [],
        }
        assert any("status must be UNCLEAR" in error for error in validate_manifest_data(manifest, root))
        implementation.write_text("changed", encoding="utf-8")
        assert any(
            "comparison source changed" in error
            for error in validate_manifest_data(manifest, root)
        )
        mockup.write_text("changed", encoding="utf-8")
        assert any("source changed" in error for error in validate_manifest_data(manifest, root))
    print("Self-test passed.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    fingerprint_parser = subparsers.add_parser("fingerprint")
    fingerprint_parser.add_argument("--root", required=True)
    fingerprint_parser.add_argument("sources", nargs="+")
    fingerprint_parser.set_defaults(handler=fingerprint_command)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--root", required=True)
    validate_parser.add_argument("--expected-target")
    validate_parser.add_argument("manifest")
    validate_parser.set_defaults(handler=validate_command)

    self_test_parser = subparsers.add_parser("self-test")
    self_test_parser.set_defaults(handler=lambda _args: self_test())
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return args.handler(args)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
