# Workflow update: activation checklist

Implementation is prepared but not activated. Do not merge the UI until both Zapier functions and the protected form are updated. The browser currently requires Zapier sign-in. No live Smartsheet rows have been modified.

## Confirmed missed return

Santa Monica Fire Alarm Plans remained active in the November 5 published register. The November 2 Smartsheet notification shows Submittal Response = RNR, a reviewed PDF uploaded by Jamel, a blank Date of Response, and Submittal Approved unchecked. The old feed ignores the response disposition. The new feed treats explicit review dispositions as Returned to GC, without representing them as approved. The response-date column is now mandatory so missing/renamed columns fail visibly instead of silently reopening records.

## Deployment order

1. Initialize data/completion-overrides.json on main with the empty schema in this change. Never replace an existing populated file.
2. Update the scheduled function with automation/zapier-with-consultant-email.mjs and the form function with automation/zapier-form-assignment.mjs. Both files are standalone Zapier bundles; workflow.mjs is the testable shared logic included inside them. Preserve existing connection IDs, private routes, filing configuration and sender.
3. Add the choices `Mark complete` and `Remove completion override` to the protected form's existing consultant_team field. Retain its password protection and item_id mapping. Completion actions save the override and do not send consultant assignments. No new public write endpoint or browser credential is introduced.
4. In the private config_json of BOTH functions set emailReviewEnabled=true, closureEmailEnabled=true, closureRecipientsVerified=true, and closureRecipients to the verified work addresses of Jamel Williams, Ruth Marcotte, Michael Sea, and Andrew Porter. Addresses were verified together in the November 5 Intuit Santa Monica slab-cut email. Keep all addresses in private configuration. mailSender must match the connected Rapt Gmail account.
5. Run with dryRun=true and copyPDFs=false to check source columns, Gmail access, routes and proposed statuses. Inspect emailReview errors. Dry runs do not send email or save completion actions.
6. Run the scheduled function once with consultantEmailEnabled=false and closureEmailEnabled=true to initialize private closure baselines without historical notifications. Check Fire Alarm Plans becomes Returned to GC. Restore the previously configured consultant-email flag after reviewing pending assignments.
7. Publish both functions and verify their first successful runs. Configure non-overlapping execution for scheduled/form syncs; completion overrides are independent of the register and updates use GitHub SHA conflict checks. Closure send claims prevent duplicate sends, and ambiguous delivery remains flagged for manual verification rather than blind retries.
8. Merge the dashboard files only after the protected form supports both new actions. Verify an authorized test record can be marked complete, stays complete on the next hourly sync, and follows source state after removing the override. A source-closed record remains closed after override removal.
9. Test a new closure after baseline: confirm exactly one notification to the four Rapt recipients. Repeated syncs and Returned to GC -> Closed must not resend. Review any uncertain notification claim against Sent mail before resetting it.

## Email review behavior and limits

- Reads the connected sender's Sent mail since the item's received date; requires project and exact RFI reference, or a unique submittal subject when source references are N/A/row numbers.
- Matches only verified consultant route recipients. Multiple matching teams or more than 50 search results are left for review, not guessed. Unmatched project abbreviations also require review.
- Reads replies in a matched thread from the verified consultant recipients. A reply flags architect review; it never closes an item.
- Stores message/thread evidence in the private ledger. Public data exposes only team and forwarding/response timestamps, not message content or Gmail links.
- Completion is determined by Smartsheet or explicit override. An arbitrary attachment or free-text response is not sufficient to close an item.
- Closure history initializes silently. New closures send once per observed active-to-complete cycle. An unobserved reopen/reclose between syncs is not separately notified.
- Mail matching has not yet been tested against the live Zapier Gmail connection. Validate runtime with current mailbox volume before enabling the hourly job.

## Local validation

Run `node --test automation/workflow.test.mjs` and syntax-check both Zapier bundles plus app.js and coordination.js. The tests cover RNR return detection, override persistence/removal, project and reference matching, replies, closure baselines, duplicate suppression, ambiguous send failures, dry-run safety, and conflict retries.

