"""
Wrapper script called by the Express API server to run book generation.
Usage:
  python runner.py generate-idea <keyword>
  python runner.py generate-book <job_id> <topic> <title> <filename> <absolute_output_dir>
"""

import sys
import os
import json
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def run_generate_idea(keyword: str):
    import contextlib
    import io as _io

    # Suppress all print/stderr output from the underlying library calls
    with contextlib.redirect_stdout(_io.StringIO()), contextlib.redirect_stderr(_io.StringIO()):
        from generate_idea import call_gemini_api
        response = call_gemini_api(keyword)

    if not response:
        sys.stdout.write(json.dumps({"error": "Failed to generate idea"}) + "\n")
        sys.exit(1)

    clean = response.strip()
    if clean.startswith("```json"):
        clean = clean[7:].strip()
    if clean.endswith("```"):
        clean = clean[:-3].strip()

    data = json.loads(clean)
    if not isinstance(data, list):
        data = [data]

    topic = data[0]
    result = {
        "topic": topic.get("topic", keyword),
        "description": topic.get("description", ""),
        "title": topic.get("title", keyword),
        "filename": topic.get("filename", keyword.lower().replace(" ", "-"))
    }
    sys.stdout.write(json.dumps(result) + "\n")


def run_generate_book(job_id: str, topic: str, title: str, filename: str, output_dir: str):
    # ── PHASE 1: chapter structure only (book_creation.py fully commented out) ──
    # Once this works in production we will add chapter content, EPUB, PDF back.

    os.makedirs(output_dir, exist_ok=True)
    status_file = os.path.join(output_dir, "status.json")

    def update_status(status: str, progress: str = "", current_chapter: str = "",
                      total_chapters: int = 0, completed_chapters: int = 0,
                      available_formats=None, error: str = ""):
        data = {
            "jobId": job_id,
            "status": status,
            "progress": progress,
            "currentChapter": current_chapter,
            "totalChapters": total_chapters,
            "completedChapters": completed_chapters,
            "availableFormats": available_formats or [],
            "error": error
        }
        with open(status_file, 'w') as f:
            json.dump(data, f)

    update_status("running", "Connecting to AI...")

    try:
        from google import genai
        from google.genai import types as genai_types

        api_key = os.environ.get("GOOGLE_API_KEY", "")
        client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})

        update_status("running", "Generating chapter structure...", total_chapters=10)

        prompt = (
            f"Create a table of contents for an academic textbook titled '{title}' on the topic: {topic}.\n"
            "Return ONLY a JSON object where each key is a chapter title (exactly 10 chapters) "
            "and each value is a list of 3-5 section titles for that chapter.\n"
            "Example format: {\"Chapter 1: Introduction\": [\"Section 1.1\", \"Section 1.2\"], ...}\n"
            "Return only valid JSON, no markdown fences."
        )

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=genai_types.GenerateContentConfig(temperature=0.7)
        )

        raw = response.text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        structure = json.loads(raw)
        chapters = list(structure.keys())
        total = len(chapters)

        update_status("running", "Building HTML outline...", total_chapters=total, completed_chapters=total)

        # Write a minimal HTML file with just the chapter structure
        base_name = os.path.splitext(filename)[0] if "." in filename else filename
        html_path = os.path.join(output_dir, f"{base_name}.html")

        rows = ""
        for i, (ch, sections) in enumerate(structure.items(), 1):
            sec_html = "".join(f"<li>{s}</li>" for s in sections)
            rows += (
                f"<details open><summary><strong>Chapter {i}: {ch}</strong></summary>"
                f"<ul>{sec_html}</ul></details>\n"
            )

        html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{title}</title>
<style>
  body {{ font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }}
  h1 {{ border-bottom: 2px solid #333; padding-bottom: 10px; }}
  details {{ margin: 12px 0; }}
  summary {{ cursor: pointer; font-size: 1.05rem; padding: 6px 0; }}
  ul {{ margin: 6px 0 6px 24px; }}
  li {{ margin: 4px 0; color: #444; }}
</style>
</head>
<body>
<h1>{title}</h1>
<p><em>Topic: {topic}</em></p>
<h2>Table of Contents</h2>
{rows}
</body></html>"""

        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html)

        update_status("completed", "Chapter structure ready!", total_chapters=total,
                      completed_chapters=total, available_formats=["html"])

    except Exception as e:
        tb = traceback.format_exc()
        update_status("failed", error=f"{str(e)}\n\n{tb}")
        sys.exit(1)


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""

    if command == "generate-idea":
        keyword = sys.argv[2] if len(sys.argv) > 2 else ""
        run_generate_idea(keyword)
    elif command == "generate-book":
        if len(sys.argv) < 7:
            print(json.dumps({"error": "generate-book requires: job_id topic title filename output_dir"}))
            sys.exit(1)
        job_id = sys.argv[2]
        topic = sys.argv[3]
        title = sys.argv[4]
        filename = sys.argv[5]
        output_dir = sys.argv[6]
        run_generate_book(job_id, topic, title, filename, output_dir)
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)
