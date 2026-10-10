import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceUrl } from './official-git-rubric.mjs';
test('evidence URL must match repository', () => { assert.equal(evidenceUrl('https://github.com/owner/repo/issues/1','owner/repo','issues'),1); assert.equal(evidenceUrl('https://github.com/other/repo/issues/1','owner/repo','issues'),null); });
