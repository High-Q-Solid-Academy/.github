/**
 * Select the exact learner approved in the HIGH-Q Admin panel, or the checked
 * learners for an explicit GitHub-side bulk approval. Never substitute all rows.
 * Safety checks of current inactivity/issue state still run in the next steps.
 */
const LOGIN_RE = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const ROW_RE = /^- \[([ xX])\] @([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)(?=\s|$)/gim;
export function selectReviewUsers(body, targetUsername = '') {
  const lines = [...String(body || '').matchAll(ROW_RE)];
  const target = String(targetUsername || '').trim();
  if (target) {
    if (!LOGIN_RE.test(target)) throw new Error('Invalid target GitHub username.');
    const matched = lines.filter(match => match[2].toLowerCase() === target.toLowerCase());
    if (matched.length !== 1) {
      throw new Error('The selected learner is not present exactly once in the private 5-day inactivity review dashboard. Refresh the monitoring scan before approving.');
    }
    return [matched[0][2]];
  }
  const checked = [...new Set(lines.filter(match => match[1].toLowerCase() === 'x').map(match => match[2].toLowerCase()))];
  if (!checked.length) throw new Error('No learners selected. Tick at least one private review checkbox or supply one verified target username.');
  if (checked.length > 50) throw new Error('A maximum of 50 learners can be approved in a single run.');
  return checked;
}
