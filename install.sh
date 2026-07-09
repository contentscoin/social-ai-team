#!/bin/bash
# Install Social AI Team skills into Claude Code

SKILLS_DIR="$HOME/.claude/skills"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing Social AI Team skills..."

SKILLS=(
  "social-media-manager"
  "brand-onboarding"
  "content-calendar"
  "caption-writer"
  "social-creative-designer"
  "social-performance-review"
  "linkedin-writer"
  "threads-writer"
  "x-writer"
  "publisher"
  "content-director"
  "reels-script"
  "ad-storyboard"
  "kr-guardrail-check"
  "kr-voice-localizer"
  "naver-blog-writer"
  "ima2"
)

for skill in "${SKILLS[@]}"; do
  src="$SCRIPT_DIR/skills/$skill"
  dst="$SKILLS_DIR/$skill"
  mkdir -p "$dst"
  cp -r "$src/." "$dst/"
  echo "  ✓ $skill"
done

AGENTS_DIR="$HOME/.claude/agents"
mkdir -p "$AGENTS_DIR"
cp "$SCRIPT_DIR"/.claude/agents/*.md "$AGENTS_DIR/"
echo "  ✓ team agents (copywriter, creative-designer, video-producer, compliance-reviewer)"

echo ""
echo "Done. All 17 skills installed to $SKILLS_DIR, team agents to $AGENTS_DIR"
echo "Open Claude Code and run /content-director (or /social-media-manager) to get started."
