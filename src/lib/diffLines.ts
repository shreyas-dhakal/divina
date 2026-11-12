/**
 * Where line `line` (1-based) of `file` in the old version is in the new one, read from the unified
 * diff `git diff --relative` gives for a checkpoint (a/ b/ prefixes, renames detected). null when
 * the line was removed or rewritten, or the file deleted. A renamed file still answers by its old
 * path, since the caller only compares line numbers.
 * ponytail: exact path match, unquoted paths only; git quotes paths with unusual characters, so those
 * read as absent (line unchanged). Unquote them if such projects show up.
 */
export function followLine(diff: string, file: string, line: number): number | null {
  for (const section of diff.split(/^(?=diff --git )/m)) {
    const header = section.match(/^diff --git a\/(.+?) b\//)?.[1];
    if (!header || /^new file mode/m.test(section)) continue;
    const old = section.match(/^rename from (.+)$/m)?.[1] ?? section.match(/^--- (?:a\/(.+)|\/dev\/null)$/m)?.[1] ?? header;
    if (old !== file) continue;
    if (/^deleted file mode/m.test(section) || /^\+\+\+ \/dev\/null$/m.test(section)) return null;

    let offset = 0;
    let oldNo = 0;
    let newNo = 0;
    let inHunk = false;
    for (const l of section.split("\n")) {
      const h = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (h) {
        if (inHunk) offset = newNo - oldNo;
        // An empty side's start is the line before it, so count from the line after.
        oldNo = +h[1] + (h[2] === "0" ? 1 : 0);
        newNo = +h[3] + (h[4] === "0" ? 1 : 0);
        if (line < oldNo) return line + offset;
        inHunk = true;
      } else if (!inHunk) continue;
      else if (l[0] === " ") {
        if (oldNo === line) return newNo;
        oldNo++;
        newNo++;
      } else if (l[0] === "-") {
        if (oldNo === line) return null;
        oldNo++;
      } else if (l[0] === "+") newNo++;
    }
    if (inHunk) offset = newNo - oldNo;
    return line + offset;
  }
  return line;
}
