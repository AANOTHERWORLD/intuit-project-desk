# Intuit | Project Desk

One shared construction administration dashboard for Chicago and Santa Monica, published with GitHub Pages. Visitors do not need to sign in.

## Publish

Settings → Pages → Deploy from a branch → main → / (root) → Save. This account requires a public repository for free Pages hosting. The expected address after successful deployment is https://aanotherworld.github.io/intuit-project-desk/.

## Manage the shared register

Edit `data/register.json` in this repository. Committing changes triggers the Pages deployment. The page refreshes its copy every minute and when returning to the tab. Data is shared by all viewers; the page does not keep browser-only edits. Managing the source requires GitHub repository access; viewing the dashboard does not.

## Data status

The initial six records are partial email-notification snapshots captured October 23–28, 2026, marked Needs verification. They are not the complete current Smartsheet register. `syncConnected` remains false until a real integration has been configured and verified. No live Smartsheet connection, automatic PDF transfer, consultant distribution, or shared editing API is running.

Source text, responses, email excerpts, private document links, internal notes and PDF files are deliberately excluded. PDFs remain in the existing project systems. Treat all fields in this repository and all of its commit history as public if repository visibility is changed to public. Only add information approved for open sharing.

## Record fields

Required fields: `id`, `project` (Chicago or Santa Monica), `type` (RFI or Submittal), `number`, `subject`, `status`. Other display fields: `discipline`, `due` (YYYY-MM-DD), `received`, `priority`, `owner`, `consultant`, `nextAction`, `sourceDate`, `detectedAt`, `triagedAt`. Unique IDs must remain stable. Mark triage only after assigning an owner and next action. Triage does not close an item.

Valid statuses: Needs verification, To assign, In review, Waiting on consultant, Ready to return, Returned to GC, Closed.

## Implementation

Plain HTML, CSS, JavaScript and JSON. No package installation, build, external script, browser credentials, or paid hosting plan is needed. Search engine indexing is discouraged with noindex/nofollow, which does not restrict access.
