#!/usr/bin/env node
/**
 * Validates the Northwind demo dataset (data/demo) against data/demo/FORMAT.md:
 * referential integrity, timestamp range, id uniqueness, ACL values and the
 * confidentiality rule for planted leadership-only facts.
 *
 * Usage: node scripts/demo-data/validate.mjs
 * Exit code 1 when any error is found.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'demo');
const RANGE_START = Date.parse('2026-04-12T00:00:00Z');
const RANGE_END = Date.parse('2026-10-12T23:59:59Z');
const TODAY = '2026-10-12';
const DOC_TYPES = new Set(['policy', 'faq', 'runbook', 'spec', 'prd', 'adr', 'handbook', 'plan', 'macro', 'pricing', 'hr']);
const TICKET_STATUS = new Set(['new', 'open', 'pending', 'solved', 'closed']);
const TICKET_PRIORITY = new Set(['low', 'normal', 'high', 'urgent']);
const ISSUE_STATE = new Set(['backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'canceled']);
const CUSTOMER_DOMAINS = new Set([
  'globexlogistics.com',
  'hooliretail.com',
  'initech.com',
  'umbrellafreight.com',
  'starkdistribution.com',
  'waynesupply.com',
  'acmefoods.com',
  'soylentgrocers.com',
]);
const CONFIDENTIAL = /\breorg|comp band/i;
const CONFIDENTIAL_ALLOWED = ['slack/leadership/', 'docs/hr-q4-comp-bands.md', 'docs/leadership-q4-reorg-plan.md'];

const errors = [];
const warnings = [];
const counts = {};
const allIds = new Map();
const overdue = [];

const rel = (p) => relative(DATA, p).replace(/\\/g, '/');
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
const count = (key, n = 1) => (counts[key] = (counts[key] ?? 0) + n);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(rel(path), `invalid JSON (${e.message})`);
    return null;
  }
}

function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile() && p.endsWith(ext))
    .sort();
}

function registerId(id, file) {
  if (!id) return err(file, 'missing id');
  if (allIds.has(id)) err(file, `duplicate id ${id} (also in ${allIds.get(id)})`);
  else allIds.set(id, file);
}

function checkTime(value, file, label) {
  const t = Date.parse(value);
  if (!value || Number.isNaN(t)) return err(file, `${label}: invalid timestamp "${value}"`);
  if (!String(value).endsWith('Z')) warn(file, `${label}: timestamp "${value}" lacks Z suffix`);
  if (t < RANGE_START || t > RANGE_END) err(file, `${label}: ${value} outside dataset range`);
}

// ---------- bible ----------
const bible = readJson(join(DATA, 'company.json'));
if (!bible) {
  console.error('company.json missing or invalid; aborting');
  process.exit(1);
}
const people = new Map(bible.people.map((p) => [p.email, p]));
const slackIds = new Map(bible.people.map((p) => [p.slackId, p]));
const externalEmails = new Set(bible.externalContacts.map((c) => c.email));
const customerIds = new Set(bible.customers.map((c) => c.id));
const projectIds = new Set(bible.projects.map((p) => p.id));
const aclGroups = new Set(bible.aclGroups);
const channels = new Map(
  bible.slackChannels.map((c) => [
    c.name,
    new Set(c.members === 'all' ? bible.people.map((p) => p.slackId) : c.members.map((id) => bible.people.find((p) => p.id === id)?.slackId)),
  ]),
);

const isKnownPerson = (email) => people.has(email);
const isAllowedExternal = (email) =>
  externalEmails.has(email) || CUSTOMER_DOMAINS.has(String(email).split('@')[1] ?? '') || /@(shipfastlogistics|paystream|keygate)\./.test(email);

function checkEmailAddress(email, file, label) {
  if (!email || !email.includes('@')) return err(file, `${label}: invalid address "${email}"`);
  if (email.endsWith('@northwind.dev')) {
    if (!isKnownPerson(email)) err(file, `${label}: unknown internal person ${email}`);
  } else if (!isAllowedExternal(email)) {
    warn(file, `${label}: external address not in bible/customer domains: ${email}`);
  }
}

function checkAcl(acl, file) {
  if (acl === null || acl === undefined) return;
  if (!Array.isArray(acl)) return err(file, `acl must be null or a list`);
  for (const a of acl) if (!aclGroups.has(a) && !isKnownPerson(a)) err(file, `unknown acl value ${a}`);
}

function checkConfidential(text, file, restricted) {
  if (!CONFIDENTIAL.test(text)) return;
  const allowed = restricted || CONFIDENTIAL_ALLOWED.some((p) => file.startsWith(p) || file === p);
  if (!allowed) err(file, 'mentions reorg/comp bands outside restricted content');
}

// ---------- slack ----------
function validateSlack() {
  const slackDir = join(DATA, 'slack');
  const users = readJson(join(slackDir, 'users.json')) ?? [];
  for (const u of users) if (!slackIds.has(u.id)) err('slack/users.json', `unknown slack user ${u.id}`);
  const chans = readJson(join(slackDir, 'channels.json')) ?? [];
  for (const c of chans) if (!channels.has(c.name)) err('slack/channels.json', `unknown channel ${c.name}`);

  for (const [name, members] of channels) {
    const dir = join(slackDir, name);
    const seen = new Set();
    for (const path of listFiles(dir, '.json')) {
      const file = rel(path);
      const day = basename(path, '.json');
      const msgs = readJson(path);
      if (!Array.isArray(msgs)) {
        err(file, 'expected an array of messages');
        continue;
      }
      for (const m of msgs) {
        registerId(m.id, file);
        if (m.type !== 'message') warn(file, `${m.id}: type should be "message"`);
        if (!slackIds.has(m.user)) err(file, `${m.id}: unknown user ${m.user}`);
        else if (!members.has(m.user)) err(file, `${m.id}: ${m.user} is not a member of #${name}`);
        checkTime(m.iso, file, m.id);
        if (m.iso && !String(m.iso).startsWith(day)) err(file, `${m.id}: iso ${m.iso} does not match file date ${day}`);
        if (!m.text) err(file, `${m.id}: empty text`);
        if (m.thread_id && !seen.has(m.thread_id)) err(file, `${m.id}: thread_id ${m.thread_id} not found earlier in #${name}`);
        checkConfidential(m.text ?? '', file, name === 'leadership');
        seen.add(m.id);
        count(`slack #${name}`);
        count('slack messages (total)');
      }
    }
  }
}

// ---------- email ----------
function validateEmail() {
  const path = join(DATA, 'email', 'threads.json');
  if (!existsSync(path)) return warn('email/threads.json', 'missing');
  const file = rel(path);
  for (const t of readJson(path) ?? []) {
    registerId(t.thread_id, file);
    checkAcl(t.acl, file);
    if (t.customer && !customerIds.has(t.customer)) err(file, `${t.thread_id}: unknown customer ${t.customer}`);
    if (t.project && !projectIds.has(t.project)) err(file, `${t.thread_id}: unknown project ${t.project}`);
    const ids = new Set();
    for (const m of t.messages ?? []) {
      registerId(m.id, file);
      checkTime(m.date, file, m.id);
      checkEmailAddress(m.from, file, `${m.id}.from`);
      for (const a of [...(m.to ?? []), ...(m.cc ?? [])]) checkEmailAddress(a, file, `${m.id}.to/cc`);
      if (m.in_reply_to && !ids.has(m.in_reply_to)) err(file, `${m.id}: in_reply_to ${m.in_reply_to} not earlier in thread`);
      checkConfidential(`${t.subject} ${m.body}`, file, Array.isArray(t.acl) && t.acl.length > 0);
      ids.add(m.id);
      count('email messages');
    }
    count('email threads');
  }
}

// ---------- docs ----------
function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value === 'null' || value === '~' || value === '') value = null;
    else if (value.startsWith('[') && value.endsWith(']'))
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    else value = value.replace(/^["']|["']$/g, '');
    meta[m[1]] = value;
  }
  return { meta, body: match[2] };
}

function validateDocs() {
  for (const path of listFiles(join(DATA, 'docs'), '.md')) {
    const file = rel(path);
    const text = readFileSync(path, 'utf8');
    const parsed = parseFrontMatter(text);
    if (!parsed) {
      err(file, 'missing YAML front-matter');
      continue;
    }
    const { meta, body } = parsed;
    registerId(meta.id, file);
    if (meta.id !== `doc-${basename(path, '.md')}`) warn(file, `id ${meta.id} does not match filename`);
    if (!meta.title) err(file, 'missing title');
    if (!isKnownPerson(meta.owner)) err(file, `unknown owner ${meta.owner}`);
    if (!meta.department) err(file, 'missing department');
    if (!DOC_TYPES.has(meta.doc_type)) err(file, `invalid doc_type ${meta.doc_type}`);
    if (meta.project && !projectIds.has(meta.project)) err(file, `unknown project ${meta.project}`);
    checkTime(meta.updated_at, file, 'updated_at');
    if (meta.created_at) checkTime(meta.created_at, file, 'created_at');
    checkAcl(meta.acl, file);
    if (!body.trim()) err(file, 'empty body');
    if (Buffer.byteLength(text) > 8192) warn(file, `large doc (${Buffer.byteLength(text)} bytes)`);
    checkConfidential(body, file, Array.isArray(meta.acl) && meta.acl.length > 0);
    count('docs');
  }
}

// ---------- meetings ----------
function validateMeetings() {
  for (const path of listFiles(join(DATA, 'meetings'), '.json')) {
    const file = rel(path);
    const m = readJson(path);
    if (!m) continue;
    registerId(m.id, file);
    checkTime(m.date, file, 'date');
    checkAcl(m.acl, file);
    if (m.project && !projectIds.has(m.project)) err(file, `unknown project ${m.project}`);
    for (const a of m.attendees ?? []) checkEmailAddress(a, file, 'attendee');
    for (const turn of m.transcript ?? []) if (!turn.text) warn(file, 'empty transcript turn');
    const restricted = Array.isArray(m.acl) && m.acl.length > 0;
    checkConfidential(JSON.stringify(m), file, restricted);
    for (const item of m.action_items ?? []) {
      if (!isKnownPerson(item.owner)) err(file, `action item owner unknown: ${item.owner}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.due ?? '')) err(file, `action item due must be YYYY-MM-DD: ${item.due}`);
      if (!['open', 'done'].includes(item.status)) err(file, `action item status invalid: ${item.status}`);
      if (item.status === 'open' && item.due < TODAY) overdue.push(`${item.due}  ${item.owner}  ${item.text}  (${file})`);
      count('action items');
    }
    count('meetings');
  }
}

// ---------- tickets & issues ----------
function validateTicketsAndIssues() {
  const issuesPath = join(DATA, 'issues', 'issues.json');
  const issues = existsSync(issuesPath) ? (readJson(issuesPath) ?? []) : [];
  if (!existsSync(issuesPath)) warn('issues/issues.json', 'missing');
  const issueIds = new Set(issues.map((i) => i.id));
  const issuesFile = 'issues/issues.json';
  const byId = new Map(issues.map((i) => [i.id, i]));
  for (const i of issues) {
    registerId(i.id, issuesFile);
    if (!ISSUE_STATE.has(i.state)) err(issuesFile, `${i.id}: invalid state ${i.state}`);
    if (i.assignee && !isKnownPerson(i.assignee)) err(issuesFile, `${i.id}: unknown assignee ${i.assignee}`);
    if (i.reporter && !isKnownPerson(i.reporter)) err(issuesFile, `${i.id}: unknown reporter ${i.reporter}`);
    if (i.project && !projectIds.has(i.project)) err(issuesFile, `${i.id}: unknown project ${i.project}`);
    checkTime(i.created_at, issuesFile, `${i.id}.created_at`);
    if (i.updated_at) checkTime(i.updated_at, issuesFile, `${i.id}.updated_at`);
    for (const key of ['blocked_by', 'blocks', 'related'])
      for (const ref of i[key] ?? []) if (!issueIds.has(ref)) err(issuesFile, `${i.id}.${key}: unknown issue ${ref}`);
    for (const ref of i.blocks ?? [])
      if (byId.has(ref) && !(byId.get(ref).blocked_by ?? []).includes(i.id)) warn(issuesFile, `${i.id} blocks ${ref} but ${ref}.blocked_by lacks it`);
    for (const ref of i.blocked_by ?? [])
      if (byId.has(ref) && !(byId.get(ref).blocks ?? []).includes(i.id)) warn(issuesFile, `${i.id} blocked_by ${ref} but ${ref}.blocks lacks it`);
    for (const c of i.comments ?? []) {
      if (!isKnownPerson(c.author)) err(issuesFile, `${i.id}: unknown comment author ${c.author}`);
      checkTime(c.created_at, issuesFile, `${i.id} comment`);
    }
    checkConfidential(JSON.stringify(i), issuesFile, false);
    count('issues');
  }

  const ticketsPath = join(DATA, 'tickets', 'tickets.json');
  if (!existsSync(ticketsPath)) return warn('tickets/tickets.json', 'missing');
  const ticketsFile = 'tickets/tickets.json';
  for (const t of readJson(ticketsPath) ?? []) {
    registerId(t.id, ticketsFile);
    if (!TICKET_STATUS.has(t.status)) err(ticketsFile, `${t.id}: invalid status ${t.status}`);
    if (!TICKET_PRIORITY.has(t.priority)) err(ticketsFile, `${t.id}: invalid priority ${t.priority}`);
    if (t.assignee && !isKnownPerson(t.assignee)) err(ticketsFile, `${t.id}: unknown assignee ${t.assignee}`);
    if (t.customer && !customerIds.has(t.customer)) err(ticketsFile, `${t.id}: unknown customer ${t.customer}`);
    if (t.requester?.email) checkEmailAddress(t.requester.email, ticketsFile, `${t.id}.requester`);
    checkTime(t.created_at, ticketsFile, `${t.id}.created_at`);
    if (t.updated_at) checkTime(t.updated_at, ticketsFile, `${t.id}.updated_at`);
    for (const ref of t.linked_issue_ids ?? []) if (!issueIds.has(ref)) err(ticketsFile, `${t.id}: unknown linked issue ${ref}`);
    for (const c of t.comments ?? []) checkTime(c.created_at, ticketsFile, `${t.id} comment`);
    checkConfidential(JSON.stringify(t), ticketsFile, false);
    count('tickets');
  }
}

validateSlack();
validateEmail();
validateDocs();
validateMeetings();
validateTicketsAndIssues();

console.log('\nNorthwind demo dataset summary');
console.table(counts);
if (overdue.length) {
  console.log(`\nOverdue open action items (as of ${TODAY}):`);
  for (const o of overdue.sort()) console.log(`  - ${o}`);
}
if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exitCode = 1;
} else {
  console.log('\nOK: no errors.');
}
