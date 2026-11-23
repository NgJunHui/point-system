# point-system

A minimal team randomiser and point tracker. Open `index.html` in a browser. There's no build step and nothing to install.

- Paste names (one per line, or comma-separated) and pick the number of teams. Sizes stay within one of each other, e.g. 17 into 3 gives 6 · 6 · 5.
- `−1 / +1 / +2 / +3` on a team gives those points to everyone on it. Each award shows an Undo toast.
- Tap a person to adjust or type their points.
- **Next game** reshuffles everyone. Points carry over.
- Reset points, Start over, and removing a player who has points all ask for confirmation first.

State is saved in the browser's localStorage, so refreshing the page keeps the current game.
