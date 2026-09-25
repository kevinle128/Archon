---
outputFile: '{planning_artifacts}/implementation-readiness-report-{{date}}.md'
---

# Step 1: Document Discovery

## STEP GOAL:

To discover, inventory, and organize all project documents, identifying duplicates and determining which versions to use for the assessment.

## MANDATORY EXECUTION RULES (READ FIRST):

### Universal Rules:

- 🛑 Never invent the target or select between ambiguous document sets.
- An explicit target slug and one complete same-lineage document set are sufficient user input for automatic selection.
- 📖 CRITICAL: Read the complete step file before taking any action
- 🔄 CRITICAL: Read the next step only after this step is saved, and read that next file completely
- 📋 YOU ARE A FACILITATOR, not a content generator
- ✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`

### Role Reinforcement:

- ✅ You are an expert Product Manager
- ✅ Your focus is on finding organizing and documenting what exists
- ✅ You identify ambiguities and ask for clarification
- ✅ Success is measured in clear file inventory and conflict resolution

### Step-Specific Rules:

- 🎯 Focus ONLY on finding and organizing files
- 🚫 Read only frontmatter and navigation references to confirm target lineage; do not analyze requirement content here
- 💬 Identify duplicate documents clearly
- 🚪 Ask the user to select documents only when the target set is missing or ambiguous

## EXECUTION PROTOCOLS:

- 🎯 Search for all document types systematically
- 💾 Group sharded files together
- 📖 Flag duplicates within the selected target lineage for user resolution
- 🚫 FORBIDDEN to proceed with unresolved missing documents or same-lineage duplicates

## DOCUMENT DISCOVERY PROCESS:

### 1. Initialize Document Discovery

"Beginning **Document Discovery** to inventory all project files.

I will:

1. Search for all required documents (PRD, Architecture, Epics, UX)
2. Group sharded documents together
3. Identify any duplicates (whole + sharded versions)
4. Ask for a choice only if the requested target does not resolve to one complete document set"

### 2. Document Search Patterns

Search for each document type using these patterns:

#### A. PRD Documents

- Whole: `{planning_artifacts}/*prd*.md`
- Sharded: `{planning_artifacts}/*prd*/index.md` and related files

#### B. Architecture Documents

- Whole: `{planning_artifacts}/*architecture*.md`
- Sharded: `{planning_artifacts}/*architecture*/index.md` and related files

#### C. Epics & Stories Documents

- Whole: `{planning_artifacts}/*epic*.md`
- Sharded: `{planning_artifacts}/*epic*/index.md` and related files

#### D. UX Design Documents

- Whole: `{planning_artifacts}/*ux*.md`
- Sharded: `{planning_artifacts}/*ux*/index.md` and related files

### 3. Organize Findings

Use the explicit target slug and the target Epic's `inputDocuments` to identify one same-lineage Requirements, Architecture, Epic, and UX set.
Documents for other targets are not duplicates of this set.
Read frontmatter and navigation references only; defer content analysis until later steps.

For each document type found:

```
## [Document Type] Files Found

**Whole Documents:**
- [filename.md] ([size], [modified date])

**Sharded Documents:**
- Folder: [foldername]/
  - index.md
  - [other files in folder]
```

### 4. Identify Critical Issues

#### Duplicates (CRITICAL)

If both whole and sharded versions belong to the same requested target and neither is identified as canonical:

```
⚠️ CRITICAL ISSUE: Duplicate document formats found
- PRD exists as both whole.md AND prd/ folder
- YOU MUST choose which version to use
- Remove or rename the other version to avoid confusion
```

#### Missing Documents (WARNING)

If required documents not found:

```
⚠️ WARNING: Required document not found
- Architecture document not found
- Will impact assessment completeness
```

### 5. Add Initial Report Section

Initialize {outputFile} with ../templates/readiness-report-template.md.

### 6. Resolve the Document Set

Display the selected files, unrelated alternatives, and any missing or duplicate same-lineage files.

If the explicit target resolves to exactly one complete same-lineage set, save that inventory to {outputFile}, update frontmatter with this completed step and the selected files, and continue without a menu.
Only after saving this step, read fully and follow: ./step-02-prd-analysis.md.
Do not batch-read future step files.

If the target is missing, a required document is missing, or more than one same-lineage set remains possible, ask one specific question showing the competing or missing paths.
Halt and wait for the user's answer.
When the answer resolves the target to one complete same-lineage set, save the inventory and completed-step frontmatter, then read ./step-02-prd-analysis.md.
If the answer does not resolve the issue, ask again and do not advance.

## CRITICAL STEP COMPLETION NOTE

ONLY WHEN the unique complete target set is proven and the document inventory is saved may you load ./step-02-prd-analysis.md.

---

## 🚨 SYSTEM SUCCESS/FAILURE METRICS

### ✅ SUCCESS:

- All document types searched systematically
- Files organized and inventoried clearly
- Same-lineage duplicates identified and flagged for resolution
- Unique target set selected automatically, or ambiguous selection confirmed by the user

### ❌ SYSTEM FAILURE:

- Not searching all document types
- Ignoring duplicate document conflicts
- Proceeding without resolving critical issues
- Not saving document inventory

**Master Rule:** Clear file identification is essential for accurate assessment.
