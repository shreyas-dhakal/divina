import { expect, test } from "vitest";
import { followLine } from "./diffLines";

// Real `git diff` output: a.txt gains a line after 1, loses 5, rewrites 10 and gains one after 18;
// gone.txt is deleted; nonl.txt changes its last line, which has no newline.
const diff = `diff --git a/a.txt b/a.txt
index 0ff3bbb..37bce4b 100644
--- a/a.txt
+++ b/a.txt
@@ -1,13 +1,13 @@
 1
+new1
 2
 3
 4
-5
 6
 7
 8
 9
-10
+ten!
 11
 12
 13
@@ -16,5 +16,6 @@
 16
 17
 18
+after18
 19
 20
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 8a1218a..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,5 +0,0 @@
-1
-2
-3
-4
-5
diff --git a/nonl.txt b/nonl.txt
index 1b32298..6e94b48 100644
--- a/nonl.txt
+++ b/nonl.txt
@@ -1,2 +1,2 @@
 x
-y
\\ No newline at end of file
+z
\\ No newline at end of file
`;

test("file absent from the diff keeps its line", () => {
  expect(followLine(diff, "src/App.tsx", 7)).toBe(7);
  expect(followLine("", "a.txt", 7)).toBe(7);
});

test("lines inside, between and after hunks", () => {
  expect(followLine(diff, "a.txt", 1)).toBe(1);
  expect(followLine(diff, "a.txt", 2)).toBe(3);
  expect(followLine(diff, "a.txt", 6)).toBe(6);
  expect(followLine(diff, "a.txt", 11)).toBe(11);
  expect(followLine(diff, "a.txt", 14)).toBe(14); // between hunks
  expect(followLine(diff, "a.txt", 19)).toBe(20); // context after the insertion
  expect(followLine(diff, "a.txt", 40)).toBe(41); // after all hunks
});

test("removed or rewritten lines and deleted files are gone", () => {
  expect(followLine(diff, "a.txt", 5)).toBeNull();
  expect(followLine(diff, "a.txt", 10)).toBeNull();
  expect(followLine(diff, "gone.txt", 2)).toBeNull();
  expect(followLine(diff, "nonl.txt", 1)).toBe(1);
  expect(followLine(diff, "nonl.txt", 2)).toBeNull();
});

test("zero-context hunks with omitted counts and pure insertions", () => {
  const u0 = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -3 +3 @@
-old
+new
@@ -10,0 +11,2 @@
+one
+two
@@ -20,2 +21,0 @@
-x
-y
`;
  expect(followLine(u0, "b.ts", 2)).toBe(2); // above all hunks
  expect(followLine(u0, "b.ts", 3)).toBeNull();
  expect(followLine(u0, "b.ts", 10)).toBe(10); // the insertion is after it
  expect(followLine(u0, "b.ts", 11)).toBe(13);
  expect(followLine(u0, "b.ts", 21)).toBeNull();
  expect(followLine(u0, "b.ts", 22)).toBe(22);
});

test("new and renamed files", () => {
  const d = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+a
+b
diff --git a/old.ts b/moved.ts
similarity 90%
rename from old.ts
rename to moved.ts
--- a/old.ts
+++ b/moved.ts
@@ -1,0 +2 @@
+inserted
`;
  expect(followLine(d, "old.ts", 1)).toBe(1);
  expect(followLine(d, "old.ts", 4)).toBe(5);
  expect(followLine(d, "moved.ts", 4)).toBe(4);
});
