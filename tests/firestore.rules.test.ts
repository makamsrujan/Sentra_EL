import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLUEPRINT_LIMITS, OperationType } from '../src/lib/firebase';

const rootDir = path.resolve(__dirname, '..');

describe('Firebase blueprint, Firestore security rules, and SDK invariants', () => {
  const blueprintPath = path.join(rootDir, 'firebase-blueprint.json');
  const rulesPath = path.join(rootDir, 'firestore.rules');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8')) as {
    entities: Record<string, { properties: Record<string, unknown>; required: string[] }>;
    firestore: Record<string, { schema: { $ref: string } }>;
  };
  const rulesText = fs.readFileSync(rulesPath, 'utf8');

  it('maps every firestore collection path in firebase-blueprint.json to explicit rules in firestore.rules', () => {
    const collectionPaths = Object.keys(blueprint.firestore);
    expect(collectionPaths).toEqual([
      '/users/{userId}',
      '/users/{userId}/private/{profileDocId}',
      '/memories/{memoryId}',
      '/wearableDevices/{deviceId}',
      '/conversations/{sessionId}',
    ]);

    expect(rulesText).toContain('match /users/{userId}');
    expect(rulesText).toContain('match /private/{profileDocId}');
    expect(rulesText).toContain('match /memories/{memoryId}');
    expect(rulesText).toContain('match /wearableDevices/{deviceId}');
    expect(rulesText).toContain('match /conversations/{sessionId}');
  });

  it('enforces default-deny catch-all, email verification, server timestamps, and immutable owner checks', () => {
    // 1. Global default deny
    expect(rulesText).toMatch(/match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/);

    // 2. Verified email & auth UID binding
    expect(rulesText).toContain('request.auth.token.email_verified == true');
    expect(rulesText).toContain('isVerifiedUser()');

    // 3. Server timestamp enforcement on create & update
    expect(rulesText).toContain('incoming().createdAt == request.time');
    expect(rulesText).toContain('incoming().updatedAt == request.time');
    expect(rulesText).toContain('incoming().createdAt == existing().createdAt');

    // 4. Schema strictness (hasAll + hasOnly + affectedKeys().hasOnly)
    expect(rulesText).toContain('hasOnly(');
    expect(rulesText).toContain('diff(existing()).affectedKeys().hasOnly(');

    // 5. PII isolation under /users/{userId}/private/profile and list disabled for user collections
    expect(rulesText).toContain("profileDocId == 'profile'");
    expect(rulesText).toMatch(/match \/users\/\{userId\}[\s\S]*allow list: if false;/);

    // 6. List query scoping for shared collections
    expect(rulesText).toContain('allow list: if isVerifiedUser() && resource.data.userId == request.auth.uid;');

    // 7. Conversation terminal status immutability guard
    expect(rulesText).toContain("existing().status != 'completed'");
  });

  it('matches client BLUEPRINT_LIMITS and OperationType contract to schema validation bounds', () => {
    expect(Object.values(OperationType)).toEqual([
      'create',
      'update',
      'delete',
      'list',
      'get',
      'write',
    ]);
    expect(BLUEPRINT_LIMITS.idPattern.test('ESP32-S3-SENTRA-001')).toBe(true);
    expect(BLUEPRINT_LIMITS.idPattern.test('../bad/id')).toBe(false);
    expect(BLUEPRINT_LIMITS.allowedVoices).toContain('Zephyr');
    expect(BLUEPRINT_LIMITS.memoryNoteMaxLength).toBe(1000);
    expect(BLUEPRINT_LIMITS.assistantTranscriptMaxLength).toBe(4000);
  });
});
