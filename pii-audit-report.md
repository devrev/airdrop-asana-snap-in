# PII/PHI Audit Report

**Connector**: airdrop-asana-snap-in  
**Files scanned**: 15  
**Date**: 2026-04-16

---

## HIGH -- 5 findings

| # | File:Line | Pattern | Description | Exposed Data | Impact |
|---|-----------|---------|-------------|--------------|--------|
| 1 | `code/src/functions/loading/workers/load-data.ts:27` | P7 | Raw `error: any` logged in `createTask` catch block | AxiosError config (Authorization header), response body | Auth token + API response in logs |
| 2 | `code/src/functions/loading/workers/load-data.ts:47` | P7 | Raw `error: any` logged in `updateTask` catch block | Same as above | Auth token + API response in logs |
| 3 | `code/src/functions/extraction/workers/attachments-extraction.ts:62` | P7 | Raw error logged in `streamAttachments` outer catch | Unknown error type -- could be AxiosError with auth headers | Credentials potentially in logs |
| 4 | `code/src/functions/extraction/workers/data-extraction.ts:261` | PX | `JSON.stringify(error)` used in error emit message for AxiosError branch | AxiosError serializes to JSON including `config.headers.authorization` and `response.data` | Auth token persisted in platform error event |
| 5 | `code/src/functions/loading/workers/load-attachments.ts:49` | PX | `JSON.stringify(error)` in `create` return value for AxiosError non-429 branch | Same as above -- full AxiosError JSON including auth headers | Auth token in load report |

## MEDIUM -- 7 findings

| # | File:Line | Pattern | Description | Exposed Data | Impact |
|---|-----------|---------|-------------|--------------|--------|
| 6 | `code/src/functions/extraction/workers/attachments-extraction.ts:27` | P8 | `serializeAxiosError` in log includes `response.data` | Asana API error response body | Indirect PII if Asana echoes user data in error |
| 7 | `code/src/functions/extraction/workers/attachments-extraction.ts:29` | P10 | Full `item` object logged on attachment fetch failure | `id`, `url` (signed Asana download URL with auth token), `file_name` (may be PII) | Signed URL grants unauthorized file access; file names may be PII |
| 8 | `code/src/functions/extraction/workers/data-extraction.ts:258` | P8 | `serializeAxiosError` in log includes `response.data` | Asana API error response body (extraction context) | Indirect PII depending on Asana error payload |
| 9 | `code/src/functions/extraction/workers/data-extraction.ts:265` | P7 | Raw non-AxiosError logged in `handleExtractionError` else branch | Non-axios error object -- stack trace, may include entity context from closures | Stack trace in logs; lower credential risk than AxiosError |
| 10 | `code/src/functions/loading/workers/load-attachments.ts:34` | P10 | Full `item` (ExternalSystemAttachment) logged when `parent_id` missing | `file_name`, `url` (DevRev attachment URL), `parent_reference_id`, `reference_id` | File names may be PII (e.g., `John_Doe_contract.pdf`) |
| 11 | `code/src/functions/loading/workers/load-attachments.ts:54` | P7 | Raw non-AxiosError logged in unexpected-error branch | Non-axios error -- stack trace, closure context | Stack trace in logs |
| 12 | `code/src/functions/extraction/workers/external-sync-units-extraction.ts:50` | P18 | Error object interpolated into emit message via `${error}` | AxiosError.toString() yields only the error message (no headers), but Asana error messages may reference user data | PII propagated to platform-persisted error event |

---

## Annotated Findings

### Finding #1 & #2 -- `load-data.ts:27` and `load-data.ts:47` (P7, HIGH)

**Verdict**: CONFIRMED  
**Reasoning**: Both `createTask` and `updateTask` catch errors typed as `any` and log them directly. The underlying HTTP calls use the AsanaClient which sets an `Authorization: Bearer` header. A failed Axios request will produce an AxiosError whose JSON serialization includes `config.headers.authorization` (the API key) and `response.data`.  
**Specific data at risk**: `config.headers.authorization` (Asana API key as Bearer token), `response.data` (Asana error body, may echo task fields like `name` or `description`).  
**Suggested fix** (`load-data.ts:26-28` and `load-data.ts:46-48`):
```typescript
// Before
} catch (error: any) {
  console.log('Could not create a task in Asana.', error);

// After
} catch (error: unknown) {
  if (axios.isAxiosError(error)) {
    console.error('Could not create a task in Asana.', serializeAxiosError(error));
  } else {
    console.error('Could not create a task in Asana.', error instanceof Error ? error.message : String(error));
  }
```

---

### Finding #3 -- `attachments-extraction.ts:62` (P7, HIGH)

**Verdict**: LIKELY  
**Reasoning**: The outer `try/catch` around `adapter.streamAttachments` logs the raw error without any type check. While SDK-level errors may not be AxiosErrors, it is not guaranteed -- if the SDK re-throws, credentials could be present. The `getFileStream` function is passed as a callback, and its errors are handled internally, but platform-level failures could surface here as AxiosErrors.  
**Specific data at risk**: Authorization header (if AxiosError), SDK internal state.  
**Suggested fix** (`attachments-extraction.ts:62`):
```typescript
// Before
console.error('An error occured while processing a task.', error);

// After
console.error('An error occured while processing a task.', error instanceof Error ? error.message : String(error));
```

---

### Finding #4 -- `data-extraction.ts:261` (PX, HIGH)

**Verdict**: CONFIRMED  
**Reasoning**: `JSON.stringify(error)` is called on an AxiosError (guarded by `axios.isAxiosError`). AxiosError's `toJSON()` method serializes `config` (including `headers.authorization`) and `response.data`. This stringified value becomes the `message` of the error emitted to the platform via `adapter.emit(ExtractionDataError)`, where it is stored persistently.  
**Specific data at risk**: `config.headers.authorization` (Asana Bearer token), `response.data` (full Asana error response).  
**Suggested fix** (`data-extraction.ts:261`):
```typescript
// Before
return { error: { message: JSON.stringify(error) } };

// After
return { error: { message: `Asana API error: HTTP ${error.response?.status ?? 'unknown'}` } };
```

---

### Finding #5 -- `load-attachments.ts:49` (PX, HIGH)

**Verdict**: CONFIRMED  
**Reasoning**: `JSON.stringify(error)` is called inside the `axios.isAxiosError(error)` branch, confirming `error` is an AxiosError. The stringified value is returned as the `error` string in `ExternalSystemItemLoadingResponse`, where it appears in load reports accessible to admins.  
**Specific data at risk**: `config.headers.authorization` (Asana Bearer token), `response.data` (Asana attachment creation error body).  
**Suggested fix** (`load-attachments.ts:49`):
```typescript
// Before
return { error: JSON.stringify(error) };

// After
return { error: `Asana API error: HTTP ${error.response?.status ?? 'unknown'}` };
```

---

### Finding #6 -- `attachments-extraction.ts:27` (P8, MEDIUM)

**Verdict**: NEEDS REVIEW  
**Reasoning**: `serializeAxiosError` is the correct SDK pattern and safe for most connectors. The risk depends on Asana's error response body format. If Asana echoes back attachment metadata (file name, URL) in its error messages, `response.data` would contain PII. In practice Asana error responses tend to be generic, making this lower risk.  
**Specific data at risk**: `response.data` from failed Asana attachment download -- potentially file metadata.  
**Suggested fix**: No immediate action required unless Asana error responses are confirmed to contain user data. Monitor and redact `response.data` if confirmed.

---

### Finding #7 -- `attachments-extraction.ts:29` (P10, MEDIUM)

**Verdict**: CONFIRMED  
**Reasoning**: `item` is the `ExternalSystemAttachmentStreamingParams.item` object. From `normalizeAttachment`, the attachment record contains `id` (gid), `url` (Asana `download_url` -- a signed URL), `file_name` (user-provided name), and `parent_id`. The signed download URL grants time-limited bearer access to the file without further authentication.  
**Specific data at risk**: `url` (signed Asana download URL with embedded auth token), `file_name` (may be PII, e.g., `John_Doe_passport.pdf`).  
**Suggested fix** (`attachments-extraction.ts:28-29`):
```typescript
// Before
console.warn('Failed attachment metadata', item);

// After
console.warn(`Failed to process attachment ${item.id}`);
```

---

### Finding #8 -- `data-extraction.ts:258` (P8, MEDIUM)

**Verdict**: NEEDS REVIEW  
**Reasoning**: Same as Finding #6 but in the extraction path. Asana task/user API errors are unlikely to echo back PII, but it cannot be ruled out without inspecting actual Asana error payloads.  
**Specific data at risk**: `response.data` from failed Asana extraction request.  
**Suggested fix**: No immediate action. Monitor Asana error response format; redact `response.data` if PII is confirmed.

---

### Finding #9 -- `data-extraction.ts:265` (P7, MEDIUM)

**Verdict**: LIKELY  
**Reasoning**: In the `else` branch (non-AxiosError), the raw error is logged. Non-axios errors are less likely to contain credentials, but they can carry closure-captured entity data via error messages or stack frames. Risk is lower than the AxiosError cases but non-zero.  
**Specific data at risk**: Error message and stack trace, potential closure-captured data.  
**Suggested fix** (`data-extraction.ts:265`):
```typescript
// Before
console.error(`Error with extraction`, error);

// After
console.error(`Error with extraction`, error instanceof Error ? error.message : String(error));
```

---

### Finding #10 -- `load-attachments.ts:34` (P10, MEDIUM)

**Verdict**: CONFIRMED  
**Reasoning**: `item` is `ExternalSystemAttachment` passed to the create function from the SDK's loading pipeline. It contains `file_name` (user-given name), `url` (DevRev CDN URL for the attachment), and IDs. File names frequently contain PII (full names, case numbers, document types).  
**Specific data at risk**: `file_name` (string -- may be PII), `url` (DevRev attachment URL).  
**Suggested fix** (`load-attachments.ts:34`):
```typescript
// Before
console.warn('Attachment has no parent_id:', item);

// After
console.warn(`Attachment ${item.reference_id} has no parent_id.`);
```

---

### Finding #11 -- `load-attachments.ts:54` (P7, MEDIUM)

**Verdict**: LIKELY  
**Reasoning**: The raw error is logged for non-AxiosError cases. Same reasoning as Finding #9 -- lower credential risk but not zero.  
**Suggested fix** (`load-attachments.ts:54`):
```typescript
// Before
console.error('Unexpected error while creating attachment', error);

// After
console.error('Unexpected error while creating attachment', error instanceof Error ? error.message : String(error));
```

---

### Finding #12 -- `external-sync-units-extraction.ts:50` (P18, MEDIUM)

**Verdict**: NEEDS REVIEW  
**Reasoning**: `${error}` coerces the error to a string via `.toString()`, which for AxiosError returns only `Error: Request failed with status code N` -- no headers or response body. The risk is low for credential exposure, but Asana error messages could theoretically include workspace/project names. This message is emitted to the platform where it persists in sync history.  
**Specific data at risk**: Asana error message text (low probability of PII).  
**Suggested fix** (`external-sync-units-extraction.ts:50`):
```typescript
// Before
message: `Failed to extract external sync units. Error fetching from Asana: ${error}`,

// After
message: `Failed to extract external sync units. HTTP ${axios.isAxiosError(error) ? error.response?.status : 'unknown'}`,
```

---

## Final Assessment

**Confirmed findings**: 7 of 12 initially flagged  
**False positives removed**: 0 (all warrant at minimum review)

| Severity | Confirmed | Likely | Needs Review | False Positive |
|----------|-----------|--------|--------------|----------------|
| HIGH | 3 | 1 | 0 | 0 |
| MEDIUM | 2 | 2 | 3 | 0 |
| LOW | 0 | 0 | 0 | 0 |

### Recommendation

The most critical issue is in `load-data.ts` -- both `createTask` and `updateTask` catch blocks log raw errors typed as `any`, which will expose the Asana API key (Bearer token) and response body when HTTP calls fail. Fix these first by adding `axios.isAxiosError` checks and using `serializeAxiosError`. Second priority: two `JSON.stringify(error)` calls on confirmed AxiosErrors in `data-extraction.ts` and `load-attachments.ts` propagate auth headers into emitted error events that persist in the DevRev platform. Beyond these four critical fixes, the attachment metadata logging (`attachments-extraction.ts:29` and `load-attachments.ts:34`) should log only IDs to avoid leaking signed download URLs and potentially identifying file names. Overall the extraction workers follow better patterns (using `serializeAxiosError`, `axios.isAxiosError` checks) while the loading workers are the weakest point. No patterns were found beyond the catalogue except the two custom `JSON.stringify(AxiosError)` cases flagged as PX.
