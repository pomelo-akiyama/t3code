# Math in chat

T3 Code renders TeX math inside agent messages, plan cards, pull request descriptions, and markdown
file previews on web and desktop.

Supported syntax:

- Inline math: `\(...\)`, on a single line
- Display math: `\[...\]` (may span lines) and `$$...$$`
- A code fence with the `math` language, following the GitHub convention

Single-dollar math is not parsed: `$x$`, `$HOME`, and prices like `$20 or $30` always stay plain
text. `latex` and `tex` code fences keep their syntax highlighting and are not typeset; only the
`math` fence renders.

The math renderer loads on demand the first time a conversation contains a formula, so messages
without math stay as fast as before. Selecting and copying a rendered formula puts its TeX source
on the clipboard in `$$...$$` form.

Mobile does not render math yet and shows the TeX source as written.
