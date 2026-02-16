# Requisition Acknowledgment Fix - Implementation Summary

## Problem
When HOD, Committee, or CEO members created requisitions, after completion the requisitions always showed status "Completed - Pending HOD Acknowledgment" and only appeared in the HOD's acknowledgment bucket. Additionally, CEO-created requisitions were not auto-advancing to Procurement - they were stuck at "Pending HOD" status.

### Issues Fixed:
1. Committee-created requisitions should go back to Committee for acknowledgment
2. CEO-created requisitions should go back to CEO for acknowledgment
3. HOD-created requisitions should stay with HOD for acknowledgment
4. **CEO-created requisitions should auto-advance directly to Procurement (HOD → Committee → CEO all auto-approved)**

## Solution
Implemented a creator role tracking system that:
- Routes completed requisitions back to the appropriate bucket based on who created them
- Auto-advances requisitions through all approval stages based on creator authority
- Sends bucket-change notifications to appropriate parties

## Changes Made

### 1. Database Migration
**File**: `database/requisition-creator-role-migration-pg.sql` (NEW)
- Added `req_creator_role` column to track creator's role (HOD, Committee, CEO, or NULL)
- Added index for query performance
- Should be run after existing migrations

### 2. Repository Layer Changes
**File**: `src/repositories/requisition.repository.js`

#### Updated Functions:
- **`createRequisition()`**: Now accepts and stores `creatorRole` parameter
- **`autoAdvanceCommitteeRequisition()`**: Sets `req_creator_role = 'Committee'` and auto-approves HOD + Committee
- **`autoAdvanceHodRequisition()`**: Sets `req_creator_role = 'HOD'` and auto-approves HOD
- **`autoAdvanceCeoRequisition()`** (NEW): Sets `req_creator_role = 'CEO'` and auto-approves HOD + Committee + CEO (goes directly to Procurement)
- **`getPendingHodAcknowledgeList()`**: Excludes Committee/CEO created requisitions
- **`getRequisitionForHodAcknowledge()`**: Includes `req_creator_role` in SELECT
- **`getPendingCommitteeRequisitions()`**: Now includes completed requisitions with `req_creator_role = 'Committee'`
- **`getPendingCeoRequisitions()`**: Now includes completed requisitions with `req_creator_role = 'CEO'`

### 3. Service Layer Changes
**File**: `src/services/requisition.service.js`

#### `createRequisition()` Function:
- Added CEO role check
- Determines creator role priority: CEO → Committee → HOD → NULL
- Passes `creatorRole` to repository function
- **Auto-advances requisitions based on creator role:**
  - **CEO**: Auto-approves HOD + Committee + CEO → Goes to Procurement
  - **Committee**: Auto-approves HOD + Committee → Goes to CEO
  - **HOD**: Auto-approves HOD → Goes to Committee
  - **Regular**: No auto-advance → Goes to HOD
- Sends bucket-change notifications to next approver

#### `acknowledgeReceipt()` Function:
- Now handles acknowledgment based on creator role
- **CEO-created**: Only CEO can acknowledge
- **Committee-created**: Only Committee members can acknowledge
- **HOD-created or regular**: Only HOD of creator's department can acknowledge
- Updated error messages to be role-specific

### 4. Status Utility Changes
**File**: `src/utils/requisition.utils.js`

#### `getRequisitionStatus()` Function:
- Updated to return role-specific status messages:
  - CEO-created: "Completed - Pending CEO Acknowledgment"
  - Committee-created: "Completed - Pending Committee Acknowledgment"
  - HOD/regular: "Completed - Pending HOD Acknowledgment"

### 5. Worker Changes
**File**: `workers/requisition-reminder-worker.js`

#### `getRequisitionBucket()` Function:
- Added logic to route completed requisitions based on creator role
- CEO-created requisitions go to 'ceo' bucket
- Committee-created requisitions go to 'committee' bucket
- HOD/regular requisitions go to 'hod' bucket

## How It Works

### Requisition Creation Flow:
1. Employee creates requisition
2. System checks if creator is CEO, Committee member, or HOD (in priority order)
3. Creator role is stored in `req_creator_role` column
4. **Auto-advance based on creator role:**
   - **CEO**: Automatically approves HOD + Committee + CEO → Status becomes "Forwarded to Procurement"
   - **Committee**: Automatically approves HOD + Committee → Status becomes "Pending CEO"
   - **HOD**: Automatically approves HOD → Status becomes "Pending Committee"
   - **Regular Employee**: No auto-advance → Status becomes "Pending HOD"
5. Bucket-change notification sent to next approver

### Example: CEO Creates Requisition
```
CEO creates requisition
  ↓
req_creator_role = 'CEO'
  ↓
Auto-approve: HOD ✓, Committee ✓, CEO ✓
  ↓
Status: "Forwarded to Procurement"
  ↓
Appears in Procurement bucket
  ↓
After procurement completes purchase
  ↓
Status: "Completed - Pending CEO Acknowledgment"
  ↓
Appears in CEO's pending bucket
  ↓
CEO acknowledges → Status: "Completed"
```

### Completion & Acknowledgment Flow:
1. Procurement marks requisition as complete (`req_purchase_completed = 1`)
2. Status changes based on `req_creator_role`:
   - CEO → "Completed - Pending CEO Acknowledgment"
   - Committee → "Completed - Pending Committee Acknowledgment"
   - HOD/NULL → "Completed - Pending HOD Acknowledgment"
3. Requisition appears in appropriate bucket:
   - CEO requisitions → `getPendingCeo()` response
   - Committee requisitions → `getPendingCommittee()` response
   - HOD requisitions → `getPendingHodAcknowledge()` response
4. Only the appropriate role can acknowledge:
   - CEO must acknowledge CEO-created requisitions
   - Committee members must acknowledge Committee-created requisitions
   - HOD must acknowledge HOD/regular requisitions

## Testing Instructions

### 1. Run Database Migration
```bash
psql -U your_username -d your_database -f database/requisition-creator-role-migration-pg.sql
```

### 2. Test HOD Created Requisition
1. Login as HOD
2. Create a requisition
3. Complete approval workflow through procurement
4. Verify status shows "Completed - Pending HOD Acknowledgment"
5. Check HOD acknowledgment endpoint - requisition should appear
6. Acknowledge as HOD - should succeed

### 3. Test Committee Created Requisition
1. Login as Committee member
2. Create a requisition (auto-advances through HOD and Committee)
3. Complete approval workflow through procurement
4. Verify status shows "Completed - Pending Committee Acknowledgment"
5. Check Committee pending endpoint - requisition should appear
6. Try to acknowledge as HOD - should fail with permission error
7. Acknowledge as Committee member - should succeed

### 4. Test CEO Created Requisition
1. Login as CEO
2. Create a requisition
3. Complete approval workflow through procurement
4. Verify status shows "Completed - Pending CEO Acknowledgment"
5. Check CEO pending endpoint - requisition should appear
6. Try to acknowledge as HOD or Committee - should fail with permission error
7. Acknowledge as CEO - should succeed

### 5. Test Regular Employee Requisition (Backward Compatibility)
1. Login as regular employee
2. Create a requisition
3. Complete approval workflow through procurement
4. Verify status shows "Completed - Pending HOD Acknowledgment"
5. Check HOD acknowledgment endpoint - requisition should appear
6. Acknowledge as department HOD - should succeed

## API Endpoints Affected

### No Changes to Endpoints (Same URLs)
- `GET /api/requisition/pending/committee/:employeeId` - Now returns completed Committee-created requisitions too
- `GET /api/requisition/pending/ceo/:employeeId` - Now returns completed CEO-created requisitions too
- `GET /api/requisition/pending/hod-acknowledge/:employeeId` - Now excludes Committee/CEO created requisitions
- `POST /api/requisition/acknowledge-receipt` - Now handles all roles based on creator

## Backward Compatibility

- Existing requisitions with `req_creator_role = NULL` will behave as before (HOD acknowledgment)
- No breaking changes to API endpoints
- Frontend changes may be needed to:
  - Show appropriate status messages
  - Display acknowledgment button in Committee/CEO buckets for completed items
  - Handle different error messages based on role

## Files Modified
1. ✅ `database/requisition-creator-role-migration-pg.sql` (NEW)
2. ✅ `src/repositories/requisition.repository.js`
3. ✅ `src/services/requisition.service.js`
4. ✅ `src/utils/requisition.utils.js`
5. ✅ `workers/requisition-reminder-worker.js`

## Next Steps
1. ✅ Run database migration
2. ⏳ Restart backend server
3. ⏳ Test all scenarios listed above
4. ⏳ Update frontend to handle new status messages
5. ⏳ Update frontend to show acknowledgment UI in Committee/CEO buckets

---
**Implementation Date**: February 14, 2026
**Status**: ✅ Complete - Ready for Testing
