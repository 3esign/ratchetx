// One release identity for the whole deploy.
//
// Every endpoint used to carry its own hand-written version string, and the
// strings drifted: on 2026-08-28 five of nine still read h70-2026-08-25 while
// the site was serving h73. That made `v` useless for the single thing it
// exists to answer — which build is actually live — and it is the check this
// project relies on after every deploy, because a Vercel deploy can fail
// silently and leave the previous build serving.
//
// So the release marker is now one constant in one place. Bump it here.
//
// NOT everything with a version is a release marker. lib/ledger.js and
// api/log.js carry INSTRUMENT versions (ldg3, log2) that roll when the rules
// of that instrument change, which is a different axis and rolls on a
// different schedule. Those stay where they are, deliberately.
module.exports = { RELEASE: 'h89-2026-08-29' };
