// Stand-in for your real triage command in demo mode: prints a canned, fictional triage note after a short pause.
const [ref = 'ITEM', ...title] = process.argv.slice(2);
await new Promise((r) => setTimeout(r, 3000));
console.log(`**Summary:** ${title.join(' ') || ref} (demo ticket, fictional).

**Likely category:** licensing / access request
**Suggested priority:** P2: a person is blocked from a tool they need
**First steps**
1. Confirm the user is in the right entitlement group.
2. Check the licence pool has free seats.
3. Assign the licence, then ask the user to sign out and back in.

**Needs a human:** approving seats if the pool is empty.`);
