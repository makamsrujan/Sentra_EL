# SENTRA Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Default-Deny Baseline:** Any collection or subcollection not explicitly matched under `/databases/{database}/documents` is denied for all reads and writes.
2. **Verified Identity Ownership:** Users may only create, read, update, or delete resources whose owner `userId` (or `uid` on `/users/{userId}`) matches `request.auth.uid` AND `request.auth.token.email_verified == true`.
3. **PII Isolation:** Account email addresses are stored exclusively at `/users/{userId}/private/profile` with `get`/`create`/`update` limited strictly to `userId == request.auth.uid` and `allow list: if false`.
4. **Temporal Integrity & Immutable Ownership:** `createdAt` must equal `request.time` on `create` and remain immutable on `update`; `updatedAt` must equal `request.time` on both `create` and `update`; owner `userId`/`uid` cannot be mutated.
5. **Bounded Payload & Strict Keys:** Every entity validation helper enforces exact allowed/required keys (`hasAll` / `hasOnly`), strict types, enum allowlists, regex ID validation (`^[a-zA-Z0-9_\-]+$`), and bounded `.size()` limits.
6. **Terminal State Locking:** `conversations/{sessionId}` once transitioned to `status == 'completed'` cannot be modified again (`existing().status != 'completed'`).
7. **Secure List Queries:** `allow list` rules on `/memories`, `/wearableDevices`, and `/conversations` always enforce `resource.data.userId == request.auth.uid` without `get()` or `exists()` lookups.

## 2. "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Shadow Field Injection on Memory Create:** `{ userId: authUid, label: "Keys", note: "On desk", room: "Study", source: "user_manual", isAdmin: true, createdAt: serverTimestamp, updatedAt: serverTimestamp }`
2. **Identity Spoofing on Memory Create:** `{ userId: "victim-uid-999", label: "Keys", note: "On desk", room: "Study", source: "user_manual", createdAt: serverTimestamp, updatedAt: serverTimestamp }`
3. **Unverified Email Token Write:** Valid payload submitted with `request.auth.token.email_verified == false`.
4. **ID Poisoning / Junk Document ID:** Writing `/memories/${"a".repeat(200)}` or `/memories/bad$id!`.
5. **Client-Forged Timestamp on Create:** `{ ..., createdAt: Timestamp.fromMillis(0), updatedAt: serverTimestamp }`
6. **Owner Hijack on Update:** Updating `/memories/{id}` with `affectedKeys` containing `userId` or altering `userId`.
7. **CreatedAt Mutation on Update:** Updating `/users/{uid}` and changing `createdAt`.
8. **Shadow Key in Partial Update:** Updating `/users/{uid}` with `{ displayName: "Updated", rogueField: "x", updatedAt: serverTimestamp }`.
9. **Value Poisoning / Oversized String:** Writing `/memories/{id}` with `note` length `> 1000` or invalid `source: "hacked"`.
10. **PII Blanket Read / Cross-User Private Profile Read:** Reading `/users/victim-uid/private/profile` as `attacker-uid`.
11. **Unfiltered Collection List Query:** Querying `/memories` without `.where("userId", "==", authUid)`.
12. **Terminal Conversation Mutation:** Updating `/conversations/{sessionId}` after `status` is already `'completed'`.
