# Clinician Shift Sign-Up

Weekday shift sign-up calendar for clinicians, November 2026 – February 2027.

- Shift: Monday–Friday, 11:00 AM – 9:00 PM (each person can adjust their start/end times if they arrive or leave early)
- Hosted on GitHub Pages; sign-ups are saved to `data.json` in this repository, so every change is version-controlled
- To reset or inspect the schedule, view `data.json` or the commit history

## How it works

The page reads `data.json` from this repository. When someone signs up, edits a time, or removes a sign-up, the page commits the updated `data.json` back to this repository through the GitHub API and refreshes.
