# Clinician Shift Sign-Up

Weekday shift sign-up calendar for clinicians, November 2026 – February 2027.

- Shift: Monday–Friday, 11:00 AM – 9:00 PM (each person can adjust their start/end times if they arrive or leave early)
- Hosted free on GitHub Pages
- Schedule data (clinician names and times) lives in the separate private repository [ed-shift-signup-data](https://github.com/tallyhomd/ed-shift-signup-data) — the site reads and writes `data.json` there through the GitHub API, and every change is version-controlled in that repo's history

## How it works

1. The page loads `data.json` from the private data repository (via the GitHub API).
2. When someone signs up, edits a time, or removes a sign-up, the page commits the updated `data.json` back to the private data repository and refreshes.
3. If two people save at the same moment, the site automatically retries with the latest version so no sign-up is lost.
