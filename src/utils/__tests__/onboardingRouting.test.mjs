import assert from 'node:assert/strict';
import { shouldShowAccountConfirmation } from '../onboardingRouting.js';

const routeCases = [
  {
    name: 'shows confirmation when permission, messages and accounts are present',
    input: { smsPermissionGranted: true, messagesRead: 12, discoveredAccountCount: 2 },
    expected: true,
  },
  {
    name: 'skips confirmation when SMS permission is denied',
    input: { smsPermissionGranted: false, messagesRead: 12, discoveredAccountCount: 2 },
    expected: false,
  },
  {
    name: 'skips confirmation when no inbox messages were read',
    input: { smsPermissionGranted: true, messagesRead: 0, discoveredAccountCount: 0 },
    expected: false,
  },
  {
    name: 'skips confirmation when messages contain no detectable account',
    input: { smsPermissionGranted: true, messagesRead: 12, discoveredAccountCount: 0 },
    expected: false,
  },
];

routeCases.forEach(({ name, input, expected }) => {
  assert.equal(shouldShowAccountConfirmation(input), expected, name);
});

console.log(`onboardingRouting: ${routeCases.length} route cases passed`);
