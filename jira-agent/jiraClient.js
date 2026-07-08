/**
 * Jira REST API client (standalone — MCP-ის გარეშე).
 * იყენებს .env-ის API token-ს (Basic auth: email:token).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.JIRA_BASE_URL;
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_API_TOKEN;
const PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'KD';

if (!BASE_URL || !EMAIL || !TOKEN) {
  throw new Error('Jira env ვერ ჩაიტვირთა — შეამოწმე .env (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)');
}

const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

/** ზოგადი API ძახილი */
async function api(method, endpoint, body) {
  const res = await fetch(`${BASE_URL}/rest/api/3${endpoint}`, {
    method,
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira API ${method} ${endpoint} failed: ${res.status} - ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/** plain text → ADF (Atlassian Document Format) — v3 API-ს სჭირდება */
function adf(text) {
  const lines = String(text).split('\n');
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

/** JQL ძებნა */
async function searchIssues(jql, fields = ['summary', 'status', 'labels', 'updated']) {
  const result = await api('POST', '/search/jql', {
    jql,
    fields,
    maxResults: 50,
  });
  return result.issues || [];
}

/** ბაგის შექმნა */
async function createBug({ summary, description, labels = [] }) {
  const result = await api('POST', '/issue', {
    fields: {
      project: { key: PROJECT_KEY },
      issuetype: { name: 'Bug' },
      summary,
      description: adf(description),
      labels,
    },
  });
  return result; // { id, key, self }
}

/** კომენტარის დამატება */
async function addComment(issueKey, text) {
  return api('POST', `/issue/${issueKey}/comment`, { body: adf(text) });
}

/** issue-ს link (მაგ. bug-ს დავუკავშიროთ ტესტ issue-ს) */
async function linkIssues(inwardKey, outwardKey, type = 'Relates') {
  return api('POST', '/issueLink', {
    type: { name: type },
    inwardIssue: { key: inwardKey },
    outwardIssue: { key: outwardKey },
  });
}

/** Agile API (boards/sprints) — /rest/agile/1.0 */
async function agileApi(method, endpoint, body) {
  const res = await fetch(`${BASE_URL}/rest/agile/1.0${endpoint}`, {
    method,
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Agile API ${method} ${endpoint} failed: ${res.status} - ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * issue-ს ჩაგდება active sprint-ში — რომ Backlog-ის ნაცვლად
 * board-ის To Do სვეტში მოხვდეს. აბრუნებს true თუ ჩაიგდო.
 */
async function addToActiveSprint(issueKey) {
  const boards = await agileApi('GET', `/board?projectKeyOrId=${PROJECT_KEY}`);
  const board = (boards.values || [])[0];
  if (!board) return false;

  const sprints = await agileApi('GET', `/board/${board.id}/sprint?state=active`);
  const sprint = (sprints.values || [])[0];
  if (!sprint) return false;

  await agileApi('POST', `/sprint/${sprint.id}/issue`, { issues: [issueKey] });
  return true;
}

/** ღია bug-ის ძებნა summary-ით (dedup — რომ დუბლიკატი არ შეიქმნას) */
async function findOpenBug(summary) {
  const safe = summary.replace(/["\\]/g, '\\$&');
  const jql = `project = ${PROJECT_KEY} AND issuetype = Bug AND statusCategory != Done AND summary ~ "${safe}" ORDER BY created DESC`;
  const issues = await searchIssues(jql, ['summary', 'status']);
  // summary ~ არის fuzzy — ზუსტი დამთხვევა შევამოწმოთ
  return issues.find((i) => i.fields.summary === summary) || null;
}

module.exports = {
  BASE_URL,
  PROJECT_KEY,
  api,
  adf,
  searchIssues,
  createBug,
  addComment,
  linkIssues,
  findOpenBug,
  addToActiveSprint,
};
